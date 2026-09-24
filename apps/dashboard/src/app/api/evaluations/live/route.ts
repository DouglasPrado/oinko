import { botAccess } from '@/server/bots/access';
import { OPERATOR, programming, programmingResponse } from '@/server/programming/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GROUPS = ['bot', 'project', 'policy', 'model'] as const;

/** Real runs of a bot grouped by project, policy version or model, with the runs behind each number. */
export function GET(request: Request) {
  if (!botAccess(request.headers)) return Response.json({ error: 'Entre na dashboard.' }, { status: 403 });
  try {
    const url = new URL(request.url);
    const botId = url.searchParams.get('botId') ?? '';
    const groupBy = GROUPS.find((item) => item === url.searchParams.get('groupBy')) ?? 'policy';
    const runtime = programming();
    if (!runtime.access.bot(botId)) return Response.json({ error: 'Bot não encontrado.', code: 'not_found' }, { status: 404 });
    return Response.json(runtime.evaluation.liveComparison(OPERATOR, { groupBy, botIds: [botId], usage: runtime.usage }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return programmingResponse(error);
  }
}
