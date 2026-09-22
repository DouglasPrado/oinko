export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Casca de tres zonas.
 *
 * A barra lateral e renderizada por cada pagina, e nao aqui, porque precisa
 * saber qual conversa e qual resposta estao abertas — o layout do App Router
 * nao recebe os parametros da rota filha.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh">{children}</div>;
}
