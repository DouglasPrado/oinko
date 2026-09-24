import { resolveEffectivePolicy } from '@oinko/agent-runtime/programming';
import { botAccess } from '@/server/bots/access';
import { programming, programmingResponse } from '@/server/programming/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Effective policy a new run of this bot would get in each authorized
 * project, with the reason when it could not start. Shown before any work.
 */
export function GET(request: Request) {
  if (!botAccess(request.headers))
    return Response.json({ error: 'Entre na dashboard.' }, { status: 403 });
  try {
    const botId = new URL(request.url).searchParams.get('botId') ?? '';
    const { access } = programming();
    const bot = access.bot(botId);
    if (!bot) return Response.json({ error: 'Bot não encontrado.', code: 'not_found' }, { status: 404 });
    const projects = access.projectIdsFor(botId).map((projectId) => {
      try {
        const snapshot = resolveEffectivePolicy(bot, access.project(projectId)!, 'change');
        return { projectId, version: snapshot.version, policy: snapshot.policy };
      } catch (error) {
        return { projectId, error: error instanceof Error ? error.message : 'Indisponível.' };
      }
    });
    return Response.json(
      { botId, enabled: bot.programming.enabled, policy: bot.programming, revision: bot.revision, projects },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return programmingResponse(error);
  }
}
