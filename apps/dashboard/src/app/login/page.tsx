import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticated, dashboardAuth } from '@/server/auth/auth';
import { localAccess } from '@/server/bots/access';
import { LoginForm } from './login-form';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export default async function LoginPage() {
  const requestHeaders = await headers();
  if (authenticated(requestHeaders)) redirect('/bots');
  const setup = !dashboardAuth().configured();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <p className="mb-3 font-mono text-xs uppercase tracking-widest text-ink-muted">Oinko</p>
      <h1 className="mb-3 text-3xl font-medium">
        {setup ? 'Proteja sua dashboard' : 'Bem-vindo de volta'}
      </h1>
      <p className="mb-8 text-sm leading-6 text-ink-muted">
        {setup
          ? 'Crie uma senha com pelo menos 12 caracteres para administrar seus bots neste computador ou pela rede.'
          : 'Entre para configurar seus bots e acompanhar as conversas.'}
      </p>
      {setup && !localAccess(requestHeaders) ? (
        <p>
          Abra a dashboard em localhost no computador que a executa para configurar a primeira
          senha.
        </p>
      ) : (
        <LoginForm setup={setup} />
      )}
    </main>
  );
}
