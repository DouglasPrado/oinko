import { botAccess } from '@/server/bots/access';
import { OPERATOR, programming, programmingResponse } from '@/server/programming/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Redacted export of one bot's evaluation history. */
export function GET(request: Request) {
  if (!botAccess(request.headers)) return Response.json({ error: 'Entre na dashboard.' }, { status: 403 });
  try {
    const botId = new URL(request.url).searchParams.get('botId') ?? '';
    const runtime = programming();
    if (!runtime.access.bot(botId)) return Response.json({ error: 'Bot não encontrado.', code: 'not_found' }, { status: 404 });
    const { content } = runtime.evaluation.export(OPERATOR, botId);
    return new Response(content, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="avaliacoes-${botId}.json"`,
      },
    });
  } catch (error) {
    return programmingResponse(error);
  }
}
