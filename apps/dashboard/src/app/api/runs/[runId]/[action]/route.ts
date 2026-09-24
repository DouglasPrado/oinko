import { z } from 'zod';
import { botAccess, readBody } from '@/server/bots/access';
import { OPERATOR, programming, programmingResponse } from '@/server/programming/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Payload = z
  .object({
    note: z.string().max(2000).optional(),
    text: z.string().max(8000).optional(),
    objective: z.string().max(8000).optional(),
    confirm: z.boolean().optional(),
  })
  .default({});

export async function POST(request: Request, context: { params: Promise<{ runId: string; action: string }> }) {
  if (!botAccess(request.headers, true))
    return Response.json({ error: 'Origem não autorizada.' }, { status: 403 });
  try {
    const { runId, action } = await context.params;
    if (!['pause', 'resume', 'cancel', 'steer'].includes(action))
      return Response.json({ error: 'Operação desconhecida.' }, { status: 404 });
    const payload = Payload.parse(await readBody(request));
    const result = programming().service.control(
      OPERATOR,
      runId,
      action as 'pause' | 'resume' | 'cancel' | 'steer',
      payload,
      'dashboard',
    );
    return Response.json({
      status: result.status,
      state: result.run.state,
      message: result.message,
      pendingReconciliation: result.pendingReconciliation,
    });
  } catch (error) {
    return programmingResponse(error);
  }
}
