import { z } from 'zod';
import { RUN_STATES } from '@oinko/agent-runtime/programming';
import { botAccess, readBody } from '@/server/bots/access';
import { OPERATOR, programming, programmingResponse } from '@/server/programming/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Start = z.object({
  botId: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  text: z.string().min(1).max(20_000),
  mode: z.enum(['change', 'analysis']).default('change'),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export function GET(request: Request) {
  if (!botAccess(request.headers))
    return Response.json({ error: 'Entre na dashboard para ver os trabalhos.' }, { status: 403 });
  try {
    const url = new URL(request.url);
    const states = url.searchParams.getAll('state').filter((state) => (RUN_STATES as readonly string[]).includes(state));
    const page = programming().queries.list(
      OPERATOR,
      {
        ...(url.searchParams.get('botId') && { botId: url.searchParams.get('botId')! }),
        ...(url.searchParams.get('projectId') && { projectId: url.searchParams.get('projectId')! }),
        ...(url.searchParams.get('taskId') && { taskId: url.searchParams.get('taskId')! }),
        ...(states.length && { states: states as (typeof RUN_STATES)[number][] }),
        ...(url.searchParams.get('cursor') && { cursor: url.searchParams.get('cursor')! }),
        limit: Math.min(100, Number(url.searchParams.get('limit') ?? 30) || 30),
      },
      'dashboard',
    );
    return Response.json(page, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return programmingResponse(error);
  }
}

export async function POST(request: Request) {
  if (!botAccess(request.headers, true))
    return Response.json({ error: 'Origem não autorizada.' }, { status: 403 });
  try {
    const input = Start.parse(await readBody(request));
    const started = programming().service.start(OPERATOR, input);
    return Response.json({
      runId: started.run.id,
      state: started.run.state,
      queuePosition: started.queuePosition,
      deduplicated: started.deduplicated,
      follow: started.follow,
    });
  } catch (error) {
    return programmingResponse(error);
  }
}
