import { botAccess, readBody } from '@/server/bots/access';
import { environmentClient } from '@/server/environments/client';
import type { RunnerCommandInput } from '@oinko/environments/client';
import { ProjectSchema } from '@oinko/workspaces/contracts';
import { recordProjectConfiguration } from '@oinko/bots/programming';
import { programming } from '@/server/programming/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function failure(error: unknown) {
  return Response.json(
    { error: error instanceof Error ? error.message : 'Não foi possível concluir a operação.' },
    { status: 400 },
  );
}
export async function GET(request: Request) {
  if (!botAccess(request.headers))
    return Response.json(
      { error: 'Entre na dashboard para administrar projetos.' },
      { status: 403 },
    );
  try {
    return Response.json(await environmentClient().state(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  if (!botAccess(request.headers, true))
    return Response.json({ error: 'Origem não autorizada.' }, { status: 403 });
  try {
    const command = (await readBody(request)) as RunnerCommandInput;
    const client = environmentClient();
    const before =
      command.action === 'saveProject'
        ? (await client.state()).projects.find((project) => project.id === command.definition.id)
        : undefined;
    const result = await client.command(command);
    if (command.action === 'saveProject')
      try {
        recordProjectConfiguration(programming().journal, before, ProjectSchema.parse(result), 'operator');
      } catch {
        // Auditing never undoes the saved project.
      }
    return Response.json(result);
  } catch (error) {
    return failure(error);
  }
}
