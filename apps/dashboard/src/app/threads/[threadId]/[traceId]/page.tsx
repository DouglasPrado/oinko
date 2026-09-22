import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getExecutionDetail } from '@/server/repositories/execution-repository';
import { ContextComposition } from '@/features/conversation/components/context-composition';
import { Timeline } from '@/features/conversation/components/timeline';
import { PayloadViewer } from '@/features/conversation/components/payload-viewer';
import { Metric } from '@/components/shared/metric';
import { formatUsd } from '@/lib/utils/format-usd';
import { formatDuration } from '@/lib/utils/format-duration';
import { formatTokens } from '@/lib/utils/format-tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ExecutionPage({
  params,
}: {
  params: Promise<{ threadId: string; traceId: string }>;
}) {
  const { threadId, traceId } = await params;
  const detail = getExecutionDetail(traceId);
  if (!detail) notFound();

  const { execution, items, injections } = detail;
  const decoded = decodeURIComponent(threadId);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <nav className="text-sm text-ink-muted">
        <Link href="/" className="text-time underline-offset-2 hover:underline">
          Conversas
        </Link>
        <span className="px-2">/</span>
        <Link
          href={`/threads/${encodeURIComponent(decoded)}`}
          className="font-mono text-time underline-offset-2 hover:underline"
        >
          {decoded}
        </Link>
      </nav>

      <header className="mt-3 border-b border-rule pb-5">
        <h1 className="text-xl font-medium">{execution.model}</h1>
        <p className="mt-1 font-mono text-xs text-ink-muted">{execution.traceId}</p>

        <div className="mt-5 flex flex-wrap gap-x-10 gap-y-4">
          <Metric label="Tempo total" value={formatDuration(execution.durationMs)} tone="time" />
          <Metric
            label="Custo real"
            value={formatUsd(execution.costUsd)}
            tone="spend"
            hint={
              execution.costStatus === 'confirmed'
                ? 'cobrado pelo provedor'
                : execution.costStatus === 'pending'
                  ? 'aguardando confirmacao'
                  : 'provedor nao informou'
            }
          />
          <Metric label="Tokens" value={formatTokens(execution.totalTokens)} />
          <Metric
            label="Entrada / saida"
            value={`${formatTokens(execution.inputTokens)} / ${formatTokens(execution.outputTokens)}`}
          />
          <Metric
            label="Fim"
            value={execution.endReason ?? execution.status}
            tone={execution.status === 'error' ? 'fault' : 'ok'}
          />
        </div>

        {execution.errorMessage ? (
          <p className="mt-4 border-l-2 border-fault bg-surface px-3 py-2 text-sm text-fault">
            {execution.errorMessage}
          </p>
        ) : null}
      </header>

      <ContextComposition injections={injections} contextTokens={execution.contextTokens} />

      <section className="mt-8" aria-labelledby="inputs-heading">
        <h2 id="inputs-heading" className="text-sm text-ink-muted">
          O que entrou
        </h2>
        <PayloadViewer label="Mensagem do usuario" payload={detail.userInput} />
        <PayloadViewer label="System prompt" payload={detail.systemPrompt} />
        <PayloadViewer label="Schema das ferramentas" payload={detail.toolsSchema} />
      </section>

      <section className="mt-8" aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="text-sm text-ink-muted">
          O que aconteceu, na ordem
        </h2>
        {items.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            Nenhuma etapa registrada para esta execucao.
          </p>
        ) : (
          <Timeline items={items} startedAt={execution.startedAt} />
        )}
      </section>
    </main>
  );
}
