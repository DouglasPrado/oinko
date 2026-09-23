import { BotId } from '@oinko/bots/schema';
import { botManager } from '@/server/bots/manager';
import { botResponse, botAccess } from '@/server/bots/access';

export const runtime = 'nodejs';
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; action: string }> },
) {
  if (!botAccess(request.headers, true))
    return Response.json({ error: 'Origem não autorizada.' }, { status: 403 });
  try {
    const { id, action } = await context.params;
    BotId.parse(id);
    if (action !== 'start' && action !== 'stop' && action !== 'restart')
      return Response.json({ error: 'Operação desconhecida.' }, { status: 404 });
    return Response.json(await botManager()[action](id));
  } catch (error) {
    return botResponse(error);
  }
}
