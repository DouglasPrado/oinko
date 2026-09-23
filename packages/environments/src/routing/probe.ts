import { request } from 'node:http';

/** Probe a named Traefik route locally without depending on DNS or fetch's Host handling. */
export function probeRoute(
  port: number,
  host: string,
  path = '/',
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const call = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        headers: { Host: host },
        agent: false,
        signal: AbortSignal.timeout(3000),
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body = (body + chunk).slice(0, 64_000);
        });
        response.once('error', reject);
        response.once('end', () => resolve({ status: response.statusCode ?? 500, body }));
      },
    );
    call.once('error', reject);
    call.end();
  });
}
