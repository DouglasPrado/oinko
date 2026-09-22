import { authenticated } from '@/server/auth/auth';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { authorizeUrl, createPkce, createState, registerClient } from '@/server/higgsfield/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vida do estado do fluxo: tempo de aprovar no browser, nao mais. */
const STATE_TTL_SECONDS = 600;

/**
 * Comeca a autorizacao.
 *
 * Registra a dashboard como cliente, guarda o segredo do PKCE num cookie
 * HttpOnly e manda o navegador ao consentimento. O verifier fica no cookie, e
 * nao na URL, porque e ele que prova que quem volta com o code e quem comecou.
 */
export async function GET(request: Request): Promise<Response> {
  if (!authenticated(request.headers)) return new Response('Não autorizado.', { status: 401 });
  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/auth/higgsfield/callback`;

  try {
    const client = await registerClient(redirectUri);
    const { verifier, challenge } = createPkce();
    const state = createState();

    const jar = await cookies();
    const options = {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: STATE_TTL_SECONDS,
      secure: origin.startsWith('https://'),
    };
    jar.set('hf_verifier', verifier, options);
    jar.set('hf_state', state, options);
    jar.set('hf_client', client.client_id, options);

    return NextResponse.redirect(
      authorizeUrl({ clientId: client.client_id, redirectUri, challenge, state }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'HIGGSFIELD_REGISTER_FAILED',
          message:
            error instanceof Error ? error.message : 'Nao foi possivel iniciar a autorizacao',
        },
      },
      { status: 502 },
    );
  }
}
