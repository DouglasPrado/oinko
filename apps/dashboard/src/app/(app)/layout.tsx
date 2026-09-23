import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticated } from '@/server/auth/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Casca de tres zonas.
 *
 * A barra lateral e renderizada por cada pagina, e nao aqui, porque precisa
 * saber qual conversa e qual resposta estao abertas — o layout do App Router
 * nao recebe os parametros da rota filha.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!authenticated(await headers())) redirect('/login');
  return <div className="min-h-dvh">{children}</div>;
}
