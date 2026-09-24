import { once } from 'node:events';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '@oinko/workspaces';
import type { Preview, Settings } from '../src/contracts/index.js';
import { NetworkPolicy, type PolicySource, type SessionScope } from '../src/browser/policy.js';
import { EgressProxy } from '../src/browser/proxy.js';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as { port: number }).port;
}

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}
function viaProxy(proxyPort: number, url: string, auth?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const call = request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        path: url,
        agent: false,
        headers: auth ? { 'Proxy-Authorization': auth } : {},
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode!, headers: response.headers, body }),
        );
      },
    );
    call.on('error', reject);
    call.end();
  });
}
function tunnel(proxyPort: number, authority: string, auth?: string) {
  return new Promise<{ status: number; socket: Socket; headers: IncomingHttpHeaders }>(
    (resolve, reject) => {
      const call = request({
        host: '127.0.0.1',
        port: proxyPort,
        method: 'CONNECT',
        path: authority,
        agent: false,
        headers: auth ? { 'Proxy-Authorization': auth } : {},
      });
      call.on('connect', (response, socket) =>
        resolve({ status: response.statusCode!, socket, headers: response.headers }),
      );
      call.on('response', (response) =>
        resolve({
          status: response.statusCode!,
          socket: response.socket,
          headers: response.headers,
        }),
      );
      call.on('error', reject);
      call.end();
    },
  );
}
async function throughTunnel(socket: Socket, host: string) {
  socket.write(`GET /inside HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
  let data = '';
  socket.setEncoding('utf8');
  for await (const chunk of socket) data += chunk;
  return data;
}
const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

describe('EgressProxy (real sockets, no browser)', () => {
  const servers: Server[] = [];
  let allowedPort: number;
  let blockedPort: number;
  let routerPort: number;
  let hits: { port: number; host?: string; path?: string }[];
  let projects: Record<string, Project | undefined>;
  let lookups: string[];
  let dialed: string[];
  let dns: Record<string, string[][]>;
  let proxy: EgressProxy;
  let proxyPort: number;
  let revoked: string[];
  const previews: Preview[] = [];
  const settings: Settings = {
    id: 'settings',
    port: 0,
    domain: '127.0.0.1.sslip.io',
    bindAddress: '127.0.0.1',
  };

  type Handler = (path: string) => {
    status: number;
    headers?: Record<string, string>;
    body: string;
  };
  async function upstream(handler: Handler) {
    const server = createServer((req, res) => {
      const port = (server.address() as { port: number }).port;
      hits.push({ port, host: req.headers.host, path: req.url });
      const reply = handler(req.url ?? '/');
      res.writeHead(reply.status, reply.headers);
      res.end(reply.body);
    });
    servers.push(server);
    return listen(server);
  }

  beforeEach(async () => {
    hits = [];
    lookups = [];
    dialed = [];
    revoked = [];
    blockedPort = await upstream(() => ({ status: 200, body: 'private-service-secret' }));
    allowedPort = await upstream((path): ReturnType<Handler> => {
      if (path === '/redirect-private')
        return { status: 302, headers: { Location: `http://127.0.0.1:${blockedPort}/` }, body: '' };
      if (path === '/redirect-chain')
        return {
          status: 302,
          headers: { Location: `http://127.0.0.1:${allowedPort}/redirect-metadata` },
          body: '',
        };
      if (path === '/redirect-metadata')
        return {
          status: 301,
          headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
          body: '',
        };
      return { status: 200, headers: { 'Set-Cookie': 'a=1' }, body: `allowed:${path}` };
    });
    routerPort = await upstream(() => ({ status: 200, body: 'router' }));
    settings.port = routerPort;
    previews.length = 0;
    previews.push(
      {
        id: 'pa',
        projectId: 'alpha',
        taskId: 'ta',
        environmentId: 'node',
        state: 'ready',
        createdAt: '2026-09-24T00:00:00.000Z',
        urls: [{ serviceId: 'web', url: `http://web-alpha.127.0.0.1.sslip.io:${routerPort}` }],
      },
      {
        id: 'pb',
        projectId: 'beta',
        taskId: 'tb',
        environmentId: 'node',
        state: 'ready',
        createdAt: '2026-09-24T00:00:00.000Z',
        urls: [{ serviceId: 'web', url: `http://web-beta.127.0.0.1.sslip.io:${routerPort}` }],
      },
    );
    const base = (id: string): Project =>
      ({
        id,
        name: id,
        repositories: [{ id: 'app', source: '/tmp/app', ref: 'HEAD' }],
        allowedBotIds: ['bot-a', 'bot-b'],
        programming: {
          commands: [],
          github: { repositories: [] },
          publisherBotIds: [],
          browser: {
            enabled: true,
            allowedOrigins: [`http://127.0.0.1:${allowedPort}`],
            publicDocs: true,
            credentials: [],
          },
        },
      }) as Project;
    projects = { alpha: base('alpha'), beta: base('beta') };
    dns = {};
    const source: PolicySource = {
      project: (id) => projects[id],
      previews: () => previews,
      settings: () => settings,
    };
    const policy = new NetworkPolicy(source, async (host) => {
      lookups.push(host);
      const answer = dns[host]?.shift();
      if (!answer) throw new Error('ENOTFOUND');
      return answer;
    });
    proxy = new EgressProxy({
      policy,
      // Test-only mapping of validated public addresses to a local server.
      dial: (address, port) => {
        dialed.push(`${address}:${port}`);
        return address === '203.0.114.7'
          ? { host: '127.0.0.1', port: allowedPort }
          : { host: address, port };
      },
      onDecision: (sessionId, decision) => {
        if (decision.code === 'access_revoked') revoked.push(sessionId);
      },
    });
    proxyPort = (await proxy.listen('127.0.0.1', 0)).port;
  });
  afterEach(async () => {
    await proxy.close();
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  const scope = (overrides: Partial<SessionScope> = {}): SessionScope => ({
    sessionId: 'bs-aaaaaaaaaaaaaaaaaaaaaaaa',
    botId: 'bot-a',
    projectId: 'alpha',
    kind: 'test',
    ...overrides,
  });

  it('requires per-session proxy credentials and rejects unknown or stale ones', async () => {
    const credentials = proxy.register(scope());
    const url = `http://127.0.0.1:${allowedPort}/`;
    expect((await viaProxy(proxyPort, url)).status).toBe(407);
    expect((await viaProxy(proxyPort, url)).headers['proxy-authenticate']).toMatch(/Basic/);
    expect((await viaProxy(proxyPort, url, basic(credentials.username, 'wrong'))).status).toBe(407);
    expect((await tunnel(proxyPort, `127.0.0.1:${allowedPort}`)).status).toBe(407);
    const ok = await viaProxy(proxyPort, url, basic(credentials.username, credentials.password));
    expect(ok).toMatchObject({ status: 200, body: 'allowed:/' });
    expect(ok.headers['set-cookie']).toEqual(['a=1']);
    proxy.unregister(credentials.username);
    expect(
      (await viaProxy(proxyPort, url, basic(credentials.username, credentials.password))).status,
    ).toBe(407);
    expect(hits.filter((hit) => hit.port === allowedPort)).toHaveLength(1);
  });

  it('never follows redirects itself: each hop of a redirect chain is decided again', async () => {
    const { username, password } = proxy.register(scope());
    const auth = basic(username, password);
    const first = await viaProxy(
      proxyPort,
      `http://127.0.0.1:${allowedPort}/redirect-private`,
      auth,
    );
    expect(first.status).toBe(302);
    const second = await viaProxy(proxyPort, first.headers.location!, auth);
    expect(second.status).toBe(403);
    expect(second.headers['x-oinko-policy']).toContain('code=private_address');
    expect(second.body).not.toContain('private-service-secret');

    const hop1 = await viaProxy(proxyPort, `http://127.0.0.1:${allowedPort}/redirect-chain`, auth);
    const hop2 = await viaProxy(proxyPort, hop1.headers.location!, auth);
    expect(hop2.status).toBe(301);
    const hop3 = await viaProxy(proxyPort, hop2.headers.location!, auth);
    expect(hop3.status).toBe(403);
    expect(hop3.headers['x-oinko-policy']).toContain('code=metadata_address');
    expect(hits.some((hit) => hit.port === blockedPort)).toBe(false);
    const decisions = proxy.decisions(username);
    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: `http://127.0.0.1:${allowedPort}`,
          allowed: true,
          count: 3,
        }),
        expect.objectContaining({
          origin: `http://127.0.0.1:${blockedPort}`,
          allowed: false,
          code: 'private_address',
        }),
        expect.objectContaining({
          origin: 'http://169.254.169.254',
          allowed: false,
          code: 'metadata_address',
        }),
      ]),
    );
    // Decisions carry origins only, never paths or queries.
    expect(JSON.stringify(decisions)).not.toContain('meta-data');
    expect(proxy.decisions(username)).toEqual([]);
  });

  it('tunnels CONNECT only to allowed targets and denies metadata and private hosts', async () => {
    const { username, password } = proxy.register(scope());
    const auth = basic(username, password);
    const open = await tunnel(proxyPort, `127.0.0.1:${allowedPort}`, auth);
    expect(open.status).toBe(200);
    expect(await throughTunnel(open.socket, `127.0.0.1:${allowedPort}`)).toContain(
      'allowed:/inside',
    );
    for (const [authority, code] of [
      ['169.254.169.254:80', 'metadata_address'],
      [`127.0.0.1:${blockedPort}`, 'private_address'],
      ['[::1]:443', 'private_address'],
      ['[::ffff:10.0.0.1]:443', 'private_address'],
      ['10.0.0.1:443', 'private_address'],
    ] as const) {
      const denied = await tunnel(proxyPort, authority, auth);
      expect(denied.status, authority).toBe(403);
      expect(denied.headers['x-oinko-policy'], authority).toContain(`code=${code}`);
      denied.socket.destroy();
    }
    expect(hits.some((hit) => hit.port === blockedPort)).toBe(false);
  });

  it('connects to the first validated address: DNS rebinding cannot reach loopback', async () => {
    const { username, password } = proxy.register(scope({ kind: 'docs' }));
    const auth = basic(username, password);
    dns['rebind.example'] = [['203.0.114.7'], ['127.0.0.1']];
    const first = await tunnel(proxyPort, 'rebind.example:443', auth);
    expect(first.status).toBe(200);
    expect(await throughTunnel(first.socket, 'rebind.example')).toContain('allowed:/inside');
    expect(lookups).toEqual(['rebind.example']);
    expect(dialed).toEqual(['203.0.114.7:443']);
    const second = await tunnel(proxyPort, 'rebind.example:443', auth);
    expect(second.status).toBe(403);
    expect(second.headers['x-oinko-policy']).toContain('code=private_address');
    second.socket.destroy();
    expect(dialed).toEqual(['203.0.114.7:443']);
    expect(lookups).toEqual(['rebind.example', 'rebind.example']);
  });

  it("routes only the session project's READY previews to the local router, preserving the Host header", async () => {
    const alpha = proxy.register(scope());
    const ok = await viaProxy(
      proxyPort,
      `http://web-alpha.127.0.0.1.sslip.io:${routerPort}/page`,
      basic(alpha.username, alpha.password),
    );
    expect(ok).toMatchObject({ status: 200, body: 'router' });
    expect(hits.at(-1)).toMatchObject({
      port: routerPort,
      host: `web-alpha.127.0.0.1.sslip.io:${routerPort}`,
    });
    const other = await viaProxy(
      proxyPort,
      `http://web-beta.127.0.0.1.sslip.io:${routerPort}/page`,
      basic(alpha.username, alpha.password),
    );
    expect(other.status).toBe(403);
    expect(hits.filter((hit) => hit.port === routerPort)).toHaveLength(1);
    // The beta session reaches its own preview on the same router.
    const beta = proxy.register(
      scope({ sessionId: 'bs-bbbbbbbbbbbbbbbbbbbbbbbb', projectId: 'beta' }),
    );
    expect(
      (
        await viaProxy(
          proxyPort,
          `http://web-beta.127.0.0.1.sslip.io:${routerPort}/`,
          basic(beta.username, beta.password),
        )
      ).status,
    ).toBe(200);
    expect(lookups).toEqual([]);
  });

  it('ends access of existing sessions as soon as the bot is removed from the project', async () => {
    const { username, password } = proxy.register(scope());
    const auth = basic(username, password);
    const url = `http://127.0.0.1:${allowedPort}/`;
    const open = await tunnel(proxyPort, `127.0.0.1:${allowedPort}`, auth);
    expect(open.status).toBe(200);
    expect((await viaProxy(proxyPort, url, auth)).status).toBe(200);
    projects.alpha = { ...projects.alpha!, allowedBotIds: ['bot-b'] };
    const denied = await viaProxy(proxyPort, url, auth);
    expect(denied.status).toBe(403);
    expect(denied.headers['x-oinko-policy']).toContain('code=access_revoked');
    expect(revoked).toEqual([username]);
    // Unregistering the session also closes tunnels opened before the revocation.
    const closed = once(open.socket, 'close');
    proxy.unregister(username);
    await closed;
  });

  it('rejects malformed proxy requests', async () => {
    const { username, password } = proxy.register(scope());
    const auth = basic(username, password);
    expect((await viaProxy(proxyPort, '/relative', auth)).status).toBe(400);
    expect((await viaProxy(proxyPort, 'ftp://example.com/', auth)).status).toBe(400);
    const bad = await tunnel(proxyPort, 'no-port', auth);
    expect(bad.status).toBe(400);
    bad.socket.destroy();
  });
});
