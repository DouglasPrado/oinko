import { botAccess } from '@/server/bots/access';
import { environmentClient } from '@/server/environments/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Installation and effective repository access of a project's GitHub App (administrator view). */
export async function GET(request: Request) {
  if (!botAccess(request.headers)) return Response.json({ error: 'Entre na dashboard.' }, { status: 403 });
  const projectId = new URL(request.url).searchParams.get('projectId') ?? '';
  try {
    const result = await environmentClient().command({ action: 'githubInstallation', projectId });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: { code: 'unavailable', message: error instanceof Error ? error.message : 'Runner indisponível.' } }, { status: 503 });
  }
}
