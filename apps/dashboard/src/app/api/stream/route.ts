import { existsSync } from 'node:fs';
import { selectTelemetry } from '@/server/repositories/telemetry-sources';
import { telemetryDb } from '@/server/repositories/telemetry-connection';
import { authenticated } from '@/server/auth/auth';
import { telemetryWatermark } from '@/server/repositories/watermark-repository';

// node:sqlite nao existe no runtime edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Com que frequencia o servidor confere se o banco mudou. */
const POLL_MS = 1_000;
/** Comentario periodico para o proxy nao encerrar a conexao ociosa. */
const HEARTBEAT_MS = 15_000;

/**
 * Avisa o navegador quando chega telemetria nova.
 *
 * O SQLite nao notifica quem le, entao quem consulta e o servidor — uma
 * contagem por segundo, que usa indice — e o navegador so recebe mensagem
 * quando algo de fato mudou. O caminho contrario, o cliente pesquisando a cada
 * segundo, refaria a pagina inteira no vazio a maior parte do tempo.
 */
export function GET(request: Request): Response {
  if (!authenticated(request.headers)) return new Response('Não autorizado.', { status: 401 });
  const telemetry = selectTelemetry(new URL(request.url).searchParams.get('bot') ?? undefined);
  if (!telemetry) return new Response('Bot não encontrado.', { status: 404 });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let previous = '';
      let closed = false;

      const send = (text: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };

      const tick = (): void => {
        let current: string;
        try {
          current = existsSync(telemetry.path)
            ? telemetryWatermark(telemetryDb(telemetry.path))
            : 'empty';
        } catch {
          // Banco indisponivel por um instante nao derruba a conexao.
          return;
        }

        if (current === previous) return;
        const first = previous === '';
        previous = current;
        if (!first) send(`event: changed\ndata: ${current}\n\n`);
      };

      tick();
      send(': ligado\n\n');

      const poll = setInterval(tick, POLL_MS);
      const beat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);

      const stop = (): void => {
        closed = true;
        clearInterval(poll);
        clearInterval(beat);
        try {
          controller.close();
        } catch {
          // ja fechado pelo cliente
        }
      };

      request.signal.addEventListener('abort', stop, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
    },
  });
}
