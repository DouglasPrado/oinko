import { randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Decision, NetworkPolicy, SessionScope, Target } from './policy.js';

/** One decision as reported to the caller: origin only, deduplicated with a count. */
export interface DecisionRecord {
  origin: string;
  rule: Decision['rule'];
  allowed: boolean;
  code: string;
  count: number;
  at: string;
}
export interface ProxyCredentials {
  username: string;
  password: string;
}
export interface ProxyOptions {
  policy: NetworkPolicy;
  /** Maps a validated address to the socket actually dialed. Tests only. */
  dial?: (address: string, port: number) => { host: string; port: number };
  onDecision?: (sessionId: string, decision: Decision) => void;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
}

interface Registration {
  scope: SessionScope;
  token: Buffer;
  decisions: DecisionRecord[];
  dropped: number;
  sockets: Set<Socket>;
}

const MAX_DECISIONS = 200;
const MAX_SOCKETS_PER_SESSION = 256;
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const REALM = 'Basic realm="oinko-browser"';

function forward(headers: IncomingHttpHeaders) {
  const out: Record<string, string | string[]> = {};
  const listed = new Set(
    String(headers.connection ?? '')
      .split(',')
      .map((name) => name.trim().toLowerCase()),
  );
  for (const [name, value] of Object.entries(headers))
    if (value !== undefined && !HOP_BY_HOP.has(name) && !listed.has(name)) out[name] = value;
  return out;
}

function authority(value: string | undefined): { host: string; port: number } | undefined {
  const match =
    /^\[([0-9a-fA-F:.%]+)\]:(\d{1,5})$/.exec(value ?? '') ??
    /^([^:[\]\s/]+):(\d{1,5})$/.exec(value ?? '');
  if (!match) return undefined;
  return { host: match[1]!, port: Number(match[2]) };
}

/**
 * HTTP egress proxy hosted by the runner. Every request of a browser context
 * (navigation, redirect, subresource, WebSocket) arrives here authenticated
 * with that session's credentials and is decided by the policy. The proxy
 * connects to the address the policy validated, so a second DNS answer
 * (rebinding) is never used. Redirects are returned to the browser, which asks
 * again for the next hop.
 */
export class EgressProxy {
  private readonly server: Server;
  private readonly sessions = new Map<string, Registration>();
  private readonly dial: NonNullable<ProxyOptions['dial']>;
  constructor(private readonly options: ProxyOptions) {
    this.dial = options.dial ?? ((host, port) => ({ host, port }));
    this.server = createServer((request, response) => {
      void this.forward(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
    });
    this.server.on('connect', (request: IncomingMessage, socket: Socket, head: Buffer) => {
      socket.on('error', () => socket.destroy());
      void this.tunnel(request, socket, head).catch(() => socket.destroy());
    });
    // WebSocket upgrades arrive as CONNECT; an absolute-form upgrade is refused.
    this.server.on('upgrade', (_request: IncomingMessage, socket: Socket) => {
      socket.end('HTTP/1.1 501 Not Implemented\r\nContent-Length: 0\r\n\r\n');
    });
    this.server.on('clientError', (_error, socket) => socket.destroy());
  }

  async listen(host: string, port = 0) {
    this.server.listen(port, host);
    await once(this.server, 'listening');
    const address = this.server.address() as { address: string; port: number };
    return { host: address.address, port: address.port };
  }

  register(scope: SessionScope): ProxyCredentials {
    const token = randomBytes(24);
    this.sessions.set(scope.sessionId, {
      scope,
      token,
      decisions: [],
      dropped: 0,
      sockets: new Set(),
    });
    return { username: scope.sessionId, password: token.toString('hex') };
  }

  /** Forgets the session and closes every connection it still holds. */
  unregister(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    for (const socket of session.sockets) socket.destroy();
  }

  /** Decisions since the previous call, oldest first. */
  decisions(sessionId: string): DecisionRecord[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    const out = session.decisions;
    session.decisions = [];
    session.dropped = 0;
    return out;
  }

  async close() {
    for (const id of [...this.sessions.keys()]) this.unregister(id);
    this.server.closeAllConnections();
    if (this.server.listening)
      await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private authenticate(request: IncomingMessage): Registration | undefined {
    const header = request.headers['proxy-authorization'];
    if (typeof header !== 'string' || !header.startsWith('Basic ')) return undefined;
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return undefined;
    const session = this.sessions.get(decoded.slice(0, separator));
    if (!session) return undefined;
    const given = Buffer.from(decoded.slice(separator + 1), 'utf8');
    const expected = Buffer.from(session.token.toString('hex'), 'utf8');
    return given.length === expected.length && timingSafeEqual(given, expected)
      ? session
      : undefined;
  }

  private async decide(session: Registration, target: Target) {
    const decision = await this.options.policy.decide(session.scope, target);
    const existing = session.decisions.find(
      (item) =>
        item.origin === decision.origin &&
        item.allowed === decision.allowed &&
        item.code === decision.code &&
        item.rule === decision.rule,
    );
    if (existing) existing.count++;
    else if (session.decisions.length < MAX_DECISIONS)
      session.decisions.push({
        origin: decision.origin,
        rule: decision.rule,
        allowed: decision.allowed,
        code: decision.code,
        count: 1,
        at: new Date().toISOString(),
      });
    else session.dropped++;
    this.options.onDecision?.(session.scope.sessionId, decision);
    return decision;
  }

  private track(session: Registration, socket: Socket) {
    session.sockets.add(socket);
    socket.once('close', () => session.sockets.delete(socket));
  }

  private async forward(request: IncomingMessage, response: ServerResponse) {
    const session = this.authenticate(request);
    if (!session) {
      response.writeHead(407, { 'Proxy-Authenticate': REALM, 'Content-Length': '0' });
      return response.end();
    }
    let url: URL;
    try {
      url = new URL(request.url ?? '');
    } catch {
      response.writeHead(400, { 'Content-Length': '0' });
      return response.end();
    }
    if (url.protocol !== 'http:') {
      response.writeHead(400, { 'Content-Length': '0' });
      return response.end();
    }
    if (session.sockets.size >= MAX_SOCKETS_PER_SESSION) {
      response.writeHead(429, { 'Content-Length': '0' });
      return response.end();
    }
    const decision = await this.decide(session, {
      scheme: 'http',
      host: url.hostname,
      port: Number(url.port || 80),
    });
    if (!decision.allowed || !decision.address || !decision.port) {
      const body = `Bloqueado pela política de rede do Oinko (${decision.code}).`;
      response.writeHead(403, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Oinko-Policy': `denied; rule=${decision.rule}; code=${decision.code}`,
        'Content-Length': String(Buffer.byteLength(body)),
      });
      return response.end(body);
    }
    const destination = this.dial(decision.address, decision.port);
    // The Host header always names the validated target, never a client-chosen value.
    const upstream = httpRequest({
      host: destination.host,
      port: destination.port,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: { ...forward(request.headers), host: url.host },
      setHost: false,
      agent: false,
      timeout: this.options.connectTimeoutMs ?? 15_000,
    });
    upstream.on('socket', (socket) => this.track(session, socket));
    if (request.socket) this.track(session, request.socket);
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'Content-Length': '0' });
      response.end();
    });
    upstream.on('response', (reply) => {
      response.writeHead(reply.statusCode ?? 502, reply.statusMessage, forward(reply.headers));
      reply.pipe(response);
    });
    request.pipe(upstream);
  }

  private async tunnel(request: IncomingMessage, socket: Socket, head: Buffer) {
    const session = this.authenticate(request);
    if (!session)
      return socket.end(
        `HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: ${REALM}\r\nContent-Length: 0\r\n\r\n`,
      );
    const target = authority(request.url);
    if (!target) return socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
    if (session.sockets.size >= MAX_SOCKETS_PER_SESSION)
      return socket.end('HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\n\r\n');
    this.track(session, socket);
    const decision = await this.decide(session, { scheme: 'tunnel', ...target });
    if (!decision.allowed || !decision.address || !decision.port)
      return socket.end(
        `HTTP/1.1 403 Forbidden\r\nX-Oinko-Policy: denied; rule=${decision.rule}; code=${decision.code}\r\nContent-Length: 0\r\n\r\n`,
      );
    const destination = this.dial(decision.address, decision.port);
    const upstream = connect({ host: destination.host, port: destination.port });
    this.track(session, upstream);
    upstream.setTimeout(this.options.connectTimeoutMs ?? 15_000, () => upstream.destroy());
    upstream.once('error', () => {
      if (socket.writable) socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
    });
    upstream.once('connect', () => {
      upstream.setTimeout(this.options.idleTimeoutMs ?? 300_000, () => upstream.destroy());
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    socket.once('close', () => upstream.destroy());
    upstream.once('close', () => socket.destroy());
  }
}
