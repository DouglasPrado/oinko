import { authenticated, sameOrigin } from '@/server/auth/auth';
import { BotError } from '@oinko/bots/schema';
import { ZodError } from 'zod';

function loopback(host: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}
export function localAccess(headers: Headers, write = false): boolean {
  const host = headers.get('host');
  if (!host || !loopback(host)) return false;
  const site = headers.get('sec-fetch-site');
  if (site === 'cross-site') return false;
  const origin = headers.get('origin');
  if (write && !origin) return false;
  if (origin) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}
export function botResponse(error: unknown): Response {
  const message =
    error instanceof BotError
      ? error.message
      : error instanceof ZodError
        ? `Confira os campos: ${error.issues.map((issue) => issue.path.join('.')).join(', ')}.`
        : 'Não foi possível concluir a operação.';
  return Response.json(
    { error: message },
    { status: error instanceof BotError || error instanceof ZodError ? 400 : 500 },
  );
}
export async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new BotError('Envie os dados em JSON.');
  let text = '';
  if (!request.body) throw new BotError('Dados ausentes.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > 200_000) throw new BotError('Configuração muito grande.');
    }
    return JSON.parse(text);
  } finally {
    await reader.cancel();
  }
}

export function botAccess(headers: Headers, write = false): boolean {
  return authenticated(headers) && (!write || sameOrigin(headers));
}
