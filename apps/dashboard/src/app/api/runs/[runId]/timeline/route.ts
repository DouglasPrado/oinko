import { botAccess } from '@/server/bots/access';
import { OPERATOR, programming, programmingResponse } from '@/server/programming/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (!botAccess(request.headers))
    return Response.json({ error: 'Entre na dashboard para ver os trabalhos.' }, { status: 403 });
  try {
    const { runId } = await context.params;
    const url = new URL(request.url);
    const afterId = url.searchParams.get('afterId');
    const types = url.searchParams.getAll('type');
    const page = programming().queries.timeline(
      OPERATOR,
      runId,
      {
        ...(afterId !== null && Number.isInteger(Number(afterId)) && { afterId: Number(afterId) }),
        ...(types.length && { types }),
        limit: Math.min(500, Number(url.searchParams.get('limit') ?? 200) || 200),
      },
      'dashboard',
    );
    return Response.json(page, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return programmingResponse(error);
  }
}
