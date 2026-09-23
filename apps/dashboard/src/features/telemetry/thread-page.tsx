import { selectTelemetry } from '@/server/repositories/telemetry-sources';
import { telemetryHref } from '@/features/telemetry/telemetry-href';
import { redirect, notFound } from 'next/navigation';
import { listExecutions } from '@/server/repositories/execution-repository';

/**
 * Abrir uma conversa leva direto a resposta mais recente.
 *
 * A lista de respostas ja vive na barra lateral, permanente; uma pagina
 * intermediaria so para repeti-la custaria um clique e nao mostraria nada
 * novo.
 */
export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { threadId } = await params;
  const decoded = decodeURIComponent(threadId);
  const query = await searchParams;
  const telemetry = selectTelemetry(typeof query.bot === 'string' ? query.bot : undefined);
  if (!telemetry?.database) notFound();
  const executions = listExecutions(decoded, telemetry.database);
  const latest = executions[0];

  if (!latest) notFound();
  return redirect(
    telemetryHref(`/threads/${encodeURIComponent(decoded)}/${latest.traceId}`, telemetry.id),
  );
}
