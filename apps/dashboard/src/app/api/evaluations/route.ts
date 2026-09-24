import { botAccess } from '@/server/bots/access';
import { OPERATOR, programming, programmingResponse } from '@/server/programming/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Evaluation history of one bot: batches, comparisons, candidates and opportunities. */
export function GET(request: Request) {
  if (!botAccess(request.headers)) return Response.json({ error: 'Entre na dashboard.' }, { status: 403 });
  try {
    const botId = new URL(request.url).searchParams.get('botId') ?? '';
    const runtime = programming();
    if (!runtime.access.bot(botId)) return Response.json({ error: 'Bot não encontrado.', code: 'not_found' }, { status: 404 });
    return Response.json(runtime.evaluation.report(OPERATOR, botId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return programmingResponse(error);
  }
}
