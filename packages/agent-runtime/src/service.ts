import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { z } from 'zod';
import {
  ConnectionManager,
  type ChannelProvider,
  type McpProvider,
  type Connections,
} from './connections.js';
import { controlRequest } from './control.js';
import type { createAgentHost } from './host.js';

export interface ServiceOptions {
  socketPath: string;
  revision?: number;
  connectionClaims?: string[];
  onClose?: () => void;
  createHost(): ReturnType<typeof createAgentHost>;
  loadConnections(): Promise<Connections>;
  channels: Record<string, ChannelProvider>;
  mcps?: Record<string, McpProvider>;
}
const Message = z.object({
  connectionId: z.string().default('local'),
  sessionId: z.string().min(1),
  text: z.string().min(1).max(200_000),
});

/** Reserve the local endpoint before creating the agent or opening any channel. */
export async function startAgentService(options: ServiceOptions) {
  let host: ReturnType<typeof createAgentHost> | undefined;
  let connections: ConnectionManager | undefined;
  const controller = new AbortController();
  let reloading = false;
  let closed: Promise<void> | undefined;
  const server = createServer((request, response) => {
    void handle(request, response).catch(() =>
      send(response, 500, { error: 'Não foi possível concluir a operação no agente.' }),
    );
  });
  function send(response: ServerResponse, status: number, value: unknown) {
    if (response.writableEnded || response.destroyed) return;
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  }
  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method === 'GET' && request.url === '/status') {
      return send(response, 200, {
        agentId: host?.runtime.name,
        pid: process.pid,
        revision: options.revision,
        connectionClaims: options.connectionClaims,
        state: connections ? 'running' : 'starting',
        connections: connections?.status() ?? [],
      });
    }
    if (!connections || !host || controller.signal.aborted)
      return send(response, 503, { error: 'Agente ainda não está disponível.' });
    if (request.method === 'POST' && request.url === '/stop') {
      send(response, 200, { stopping: true });
      setImmediate(() => {
        void close();
      });
      return;
    }
    if (request.method === 'POST' && request.url === '/reload') {
      if (reloading) return send(response, 409, { error: 'Reconfiguração em andamento.' });
      reloading = true;
      try {
        await connections.reconcile(await options.loadConnections());
        send(response, 200, { connections: connections.status() });
      } finally {
        reloading = false;
      }
      return;
    }
    if (request.method !== 'POST' || request.url !== '/message')
      return send(response, 404, { error: 'Operação desconhecida.' });
    let raw = '';
    for await (const chunk of request) {
      raw += String(chunk);
      if (raw.length > 1_000_000) {
        send(response, 413, { error: 'Mensagem muito grande.' });
        return;
      }
    }
    const parsed = Message.safeParse(JSON.parse(raw));
    if (!parsed.success) return send(response, 400, { error: 'Mensagem inválida.' });
    const { connectionId, sessionId, text } = parsed.data;
    if (!connections.hasChannel(connectionId, 'cli'))
      return send(response, 409, { error: 'Esse canal CLI não está habilitado.' });
    const disconnected = new AbortController();
    const onClose = () => disconnected.abort();
    response.on('close', onClose);
    try {
      const answer = await host.runtime.handle(
        { channel: 'cli', connectionId, conversationId: sessionId },
        text,
        AbortSignal.any([controller.signal, disconnected.signal]),
      );
      send(response, 200, { answer });
    } finally {
      response.removeListener('close', onClose);
    }
  }
  // A dead Unix socket can survive a crash. Never unlink a live listener or a
  // socket replaced by another starter while probing it.
  if (process.platform !== 'win32') {
    const before = await lstat(options.socketPath).catch(() => undefined);
    if (before) {
      if (!before.isSocket())
        throw new Error('O caminho local do agente está ocupado por outro arquivo.');
      const alive = await controlRequest(
        options.socketPath,
        '/status',
        undefined,
        AbortSignal.timeout(1000),
      ).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') return false;
          throw error;
        },
      );
      if (alive) throw new Error('Este agente já está rodando. Conecte a CLI com o comando chat.');
      const after = await lstat(options.socketPath).catch(() => undefined);
      if (after?.ino === before.ino) await unlink(options.socketPath);
    }
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  async function close(): Promise<void> {
    closed ??= (async () => {
      controller.abort();
      try {
        await connections?.close();
      } finally {
        try {
          await host?.close();
        } finally {
          // Keep the endpoint reserved while providers drain. A restart must
          // not acquire the same channel before the previous worker releases it.
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
          options.onClose?.();
        }
      }
    })();
    return closed;
  }
  try {
    if (process.platform !== 'win32') await chmod(options.socketPath, 0o600);
    const config = await options.loadConnections();
    host = options.createHost();
    connections = new ConnectionManager(host, options.channels, options.mcps);
    await connections.reconcile(config);
    return { close, status: () => connections!.status(), runtime: host.runtime };
  } catch (error) {
    await close();
    throw error;
  }
}
