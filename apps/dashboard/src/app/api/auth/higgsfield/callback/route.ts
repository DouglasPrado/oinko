import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCode } from '@/server/higgsfield/oauth';
import { saveCredential } from '@/server/higgsfield/credential-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function back(origin: string, status: string): Response {
  return NextResponse.redirect(`${origin}/integracoes?higgsfield=${status}`);
}

/**
 * Recebe o retorno do consentimento e grava a credencial.
 *
 * O state do cookie tem de bater com o da query: sem isso, um link forjado
 * poderia fazer o navegador de quem esta logado trocar um code de outra pessoa.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const jar = await cookies();

  const clear = (): void => {
    for (const name of ['hf_verifier', 'hf_state', 'hf_client']) jar.delete(name);
  };

  if (url.searchParams.get('error')) {
    clear();
    return back(origin, 'negado');
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const verifier = jar.get('hf_verifier')?.value;
  const expectedState = jar.get('hf_state')?.value;
  const clientId = jar.get('hf_client')?.value;

  if (!code || !verifier || !clientId || !state || state !== expectedState) {
    clear();
    return back(origin, 'invalido');
  }

  try {
    const tokens = await exchangeCode({
      code,
      verifier,
      clientId,
      redirectUri: `${origin}/api/auth/higgsfield/callback`,
    });

    saveCredential({ client_id: clientId, ...tokens, obtained_at: Date.now() });
    clear();
    return back(origin, 'ok');
  } catch {
    clear();
    return back(origin, 'falhou');
  }
}
