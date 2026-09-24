import { botAccess } from '@/server/bots/access';
import { OPERATOR, programming, programmingResponse } from '@/server/programming/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (!botAccess(request.headers))
    return Response.json({ error: 'Entre na dashboard para ver os trabalhos.' }, { status: 403 });
  try {
    const { runId } = await context.params;
    const runtime = programming();
    const detail = runtime.queries.detail(OPERATOR, runId, 'dashboard');
    const url = new URL(request.url);
    // Bot-scoped routes must not show another bot's run by guessing its id.
    const botId = url.searchParams.get('botId');
    if (botId && detail.run.botId !== botId)
      return Response.json({ error: 'Trabalho não encontrado.', code: 'not_found' }, { status: 404 });
    runtime.journal.record(
      'run_observed',
      { botId: detail.run.botId, projectId: detail.run.projectId, runId },
      { interface: 'dashboard', actorKind: 'operator' },
    );
    return Response.json(detail, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return programmingResponse(error);
  }
}
