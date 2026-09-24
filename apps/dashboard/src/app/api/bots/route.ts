import { z } from 'zod';
import { BotDefinitionSchema, BotSecretsSchema } from '@oinko/bots/schema';
import { botManager } from '@/server/bots/manager';
import { botResponse, botAccess, readBody } from '@/server/bots/access';
import { recordBotConfiguration } from '@oinko/bots/programming';
import { programming } from '@/server/programming/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const Save = z.object({
  definition: BotDefinitionSchema,
  secrets: BotSecretsSchema.default({}),
  revision: z.number().int().nonnegative(),
});
export async function GET(request: Request) {
  if (!botAccess(request.headers))
    return Response.json(
      { error: 'Entre na dashboard para administrar os bots.' },
      { status: 403 },
    );
  try {
    return Response.json(await botManager().list(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return botResponse(error);
  }
}
export async function POST(request: Request) {
  if (!botAccess(request.headers, true))
    return Response.json({ error: 'Origem não autorizada.' }, { status: 403 });
  try {
    const input = Save.parse(await readBody(request));
    const store = botManager().store;
    const before = store.has(input.definition.id) ? store.runtime(input.definition.id).definition : undefined;
    const profile = store.save(input.definition, input.secrets, input.revision);
    try {
      recordBotConfiguration(programming().journal, before, BotDefinitionSchema.parse(profile), 'operator', profile.revision);
    } catch {
      // Auditing must not undo a saved configuration; the journal reports its own failures.
    }
    return Response.json(profile);
  } catch (error) {
    return botResponse(error);
  }
}
