import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { request } from 'node:http';

export function serviceSocketPath(dataDir: string): string {
  const key = createHash('sha256').update(resolve(dataDir)).digest('hex').slice(0, 20);
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\oinko-${key}`
    : join('/tmp', `oinko-${process.getuid?.() ?? 'user'}-${key}.sock`);
}
export async function controlRequest<T = unknown>(
  socketPath: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path,
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
      },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          data += chunk;
          if (data.length > 4 * 1024 * 1024) req.destroy(new Error('Resposta local muito grande.'));
        });
        response.on('error', reject);
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data) as T & { error?: string };
            if ((response.statusCode ?? 500) >= 400)
              reject(new Error(parsed.error ?? 'Falha no agente.'));
            else resolve(parsed);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
