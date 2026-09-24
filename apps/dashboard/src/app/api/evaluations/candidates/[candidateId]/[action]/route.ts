import { z } from 'zod';
import { DELIVERY_TOOL_NAMES, PROGRAMMING_TOOL_NAMES } from '@oinko/bots/programming';
import { botAccess } from '@/server/bots/access';
import { OPERATOR, programming, programmingResponse } from '@/server/programming/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ note: z.string().trim().max(2000).default('') });

/**
 * Operator decisions on a candidate. Approval needs a note and an evaluation
 * that recommends it; promotion and rollback go through the bot revision.
 */
export async function POST(request: Request, context: { params: Promise<{ candidateId: string; action: string }> }) {
  if (!botAccess(request.headers)) return Response.json({ error: 'Entre na dashboard.' }, { status: 403 });
  try {
    const { candidateId, action } = await context.params;
    const { note } = Body.parse(await request.json().catch(() => ({})));
    const { evaluation } = programming();
    switch (action) {
      case 'approve':
        if (!note) return Response.json({ error: 'Registre o motivo da aprovação.', code: 'invalid_request' }, { status: 400 });
        return Response.json(evaluation.approve(OPERATOR, candidateId, note));
      case 'promote':
        // The runtime's tool catalog: a candidate needing anything else is refused.
        return Response.json(evaluation.promote(OPERATOR, candidateId, { availableTools: [...PROGRAMMING_TOOL_NAMES, ...DELIVERY_TOOL_NAMES] }));
      case 'rollback':
        return Response.json(evaluation.rollback(OPERATOR, candidateId));
      case 'observe':
        return Response.json(evaluation.observe(candidateId));
      default:
        return Response.json({ error: 'Ação desconhecida.', code: 'not_found' }, { status: 404 });
    }
  } catch (error) {
    return programmingResponse(error);
  }
}
