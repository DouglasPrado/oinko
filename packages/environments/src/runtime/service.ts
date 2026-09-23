import { createServer } from 'node:http';
import { chmodSync, lstatSync, unlinkSync } from 'node:fs';
import { EnvironmentController } from './controller.js';
import { environmentRequest, environmentSocket } from '../client/index.js';

export async function startEnvironmentService(root: string) {
  const socket = environmentSocket(root);
  try {
    const before = lstatSync(socket);
    if (!before.isSocket())
      throw new Error('O caminho do gerenciador está ocupado por outro arquivo.');
    const alive = await environmentRequest(root, '/health', undefined, 1000).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') return false;
        throw error;
      },
    );
    if (alive) throw new Error('O gerenciador já está em execução.');
    if (lstatSync(socket).ino === before.ino) unlinkSync(socket);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let controller: EnvironmentController | undefined;
  let ready = false;
  const server = createServer((request, response) => {
    const send = (code: number, value: unknown) => {
      if (!response.writableEnded) {
        response.writeHead(code, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(value));
      }
    };
    void (async () => {
      if (request.method === 'GET' && request.url === '/health')
        return send(200, { ready, pid: process.pid });
      if (!ready || !controller) return send(503, { error: 'Gerenciador iniciando.' });
      if (request.method !== 'POST' || request.url !== '/command')
        return send(404, { error: 'Operação desconhecida.' });
      let body = '';
      for await (const chunk of request) {
        body += String(chunk);
        if (body.length > 1_000_000) return send(413, { error: 'Requisição muito grande.' });
      }
      send(200, await controller.handle(JSON.parse(body)));
    })().catch((error) =>
      send(400, {
        error:
          controller?.redact(error instanceof Error ? error.message : 'Operação falhou.') ??
          'Gerenciador indisponível.',
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socket, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  chmodSync(socket, 0o600);
  try {
    controller = new EnvironmentController(root);
    await controller.recover();
    ready = true;
  } catch (error) {
    server.close();
    controller?.close();
    throw error;
  }
  return {
    controller,
    async close() {
      ready = false;
      await controller!.drain();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      controller!.close();
    },
  };
}
