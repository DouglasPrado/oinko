import { NextResponse } from 'next/server';
import { z } from 'zod';
import { dashboardAuth, sameOrigin, SESSION_COOKIE } from '@/server/auth/auth';
import { localAccess, readBody } from '@/server/bots/access';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!sameOrigin(request.headers))
    return NextResponse.json({ error: 'Origem não autorizada.' }, { status: 403 });
  try {
    const input = z
      .object({ password: z.string().min(1).max(1024), setup: z.boolean().default(false) })
      .parse(await readBody(request));
    const auth = dashboardAuth();
    if (input.setup) {
      if (!localAccess(request.headers, true))
        return NextResponse.json(
          { error: 'Configure a senha primeiro no computador que executa a dashboard.' },
          { status: 403 },
        );
      await auth.setup(input.password);
    }
    const token = await auth.login(input.password);
    if (!token) return NextResponse.json({ error: 'Senha incorreta.' }, { status: 401 });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(request.url).protocol === 'https:',
      path: '/',
      maxAge: 7 * 24 * 3600,
    });
    return response;
  } catch {
    return NextResponse.json(
      {
        error:
          'Não foi possível entrar. Confira a senha (mínimo de 12 caracteres na configuração inicial) ou aguarde um minuto se houve várias tentativas.',
      },
      { status: 400 },
    );
  }
}
export function DELETE(request: Request) {
  if (!sameOrigin(request.headers))
    return NextResponse.json({ error: 'Origem não autorizada.' }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
