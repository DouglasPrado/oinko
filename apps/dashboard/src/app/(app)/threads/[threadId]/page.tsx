import { redirect, notFound } from 'next/navigation';
import { listExecutions } from '@/server/repositories/execution-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Abrir uma conversa leva direto a resposta mais recente.
 *
 * A lista de respostas ja vive na barra lateral, permanente; uma pagina
 * intermediaria so para repeti-la custaria um clique e nao mostraria nada
 * novo.
 */
export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const decoded = decodeURIComponent(threadId);
  const executions = listExecutions(decoded);
  const latest = executions[0];

  if (!latest) notFound();
  redirect(`/threads/${encodeURIComponent(decoded)}/${latest.traceId}`);
}
