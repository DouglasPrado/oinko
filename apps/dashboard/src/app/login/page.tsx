import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticated, dashboardAuth } from '@/server/auth/auth';
import { localAccess } from '@/server/bots/access';
import { Logo } from '@/components/shared/brand';
import { LoginForm } from './login-form';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export default async function LoginPage() {
  const requestHeaders = await headers();
  if (authenticated(requestHeaders)) redirect('/bots');
  const setup = !dashboardAuth().configured();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="h-14" />
          <p className="mt-3 mb-8 text-[10px] font-medium tracking-[0.28em] text-ink-muted uppercase">
            Small steps. Brighter tomorrows.
          </p>
          <h1 className="text-2xl leading-[1.3] font-semibold tracking-[-0.4px]">
            {setup ? 'Proteja sua dashboard' : 'Bem-vindo de volta'}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            {setup
              ? 'Crie uma senha com pelo menos 12 caracteres para administrar seus bots neste computador ou pela rede.'
              : 'Entre para configurar seus bots e acompanhar as conversas.'}
          </p>
        </div>
        <div className="rounded-xl border border-rule bg-canvas p-6">
          {setup && !localAccess(requestHeaders) ? (
            <p className="text-sm text-ink">
              Abra a dashboard em localhost no computador que a executa para configurar a primeira
              senha.
            </p>
          ) : (
            <LoginForm setup={setup} />
          )}
        </div>
      </div>
    </main>
  );
}
