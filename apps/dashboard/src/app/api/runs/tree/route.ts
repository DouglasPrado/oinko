import { botAccess } from '@/server/bots/access';
import { OPERATOR, programming, programmingResponse } from '@/server/programming/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** bot → projeto → tarefa → runs, com contagem por estado. */
export function GET(request: Request) {
  if (!botAccess(request.headers))
    return Response.json({ error: 'Entre na dashboard para ver os trabalhos.' }, { status: 403 });
  try {
    return Response.json(programming().queries.tree(OPERATOR, 'dashboard'), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return programmingResponse(error);
  }
}
