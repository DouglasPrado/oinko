import { botAccess } from '@/server/bots/access';
import { OPERATOR, programming, programmingResponse } from '@/server/programming/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INLINE = new Set(['text/plain', 'text/markdown', 'text/x-diff', 'application/json', 'image/png', 'image/jpeg']);

/** Authorized evidence download; expiration and missing capture are explicit errors. */
export async function GET(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  if (!botAccess(request.headers))
    return Response.json({ error: 'Entre na dashboard para ver evidências.' }, { status: 403 });
  try {
    const { artifactId } = await context.params;
    const runtime = programming();
    const { artifact, content } = runtime.artifacts.read(OPERATOR, artifactId, 'dashboard');
    runtime.journal.record(
      'evidence_opened',
      { botId: artifact.accessScope.botId, projectId: artifact.accessScope.projectId, runId: artifact.runId },
      { artifactId, interface: 'dashboard' },
    );
    const type = INLINE.has(artifact.mediaType) ? artifact.mediaType : 'application/octet-stream';
    return new Response(new Uint8Array(content), {
      headers: {
        'Content-Type': type.startsWith('text/') ? `${type}; charset=utf-8` : type,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'",
        'Content-Disposition': `${INLINE.has(artifact.mediaType) ? 'inline' : 'attachment'}; filename="${artifact.id}"`,
      },
    });
  } catch (error) {
    return programmingResponse(error);
  }
}
