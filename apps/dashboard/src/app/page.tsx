import { Activity } from 'lucide-react';
import { listThreads } from '@/server/repositories/thread-repository';
import { ThreadFiltersSchema } from '@/features/threads/schemas/thread.schema';
import { ThreadTable } from '@/features/threads/components/thread-table';
import { ThreadFiltersForm } from '@/features/threads/components/thread-filters-form';
import { EmptyState } from '@/components/shared/empty-state';
import { Metric } from '@/components/shared/metric';
import { formatUsd } from '@/lib/utils/format-usd';
import { formatDuration } from '@/lib/utils/format-duration';
import { formatTokens } from '@/lib/utils/format-tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ThreadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Nunca lanca: uma URL editada a mao cai nos defaults em vez de dar 500.
  const filters = ThreadFiltersSchema.parse({
    q: typeof params.q === 'string' ? params.q : '',
    model: typeof params.model === 'string' ? params.model : '',
    status: params.status === 'ok' || params.status === 'error' ? params.status : 'all',
  });

  const threads = listThreads(filters);

  // Custo desconhecido nao entra no total e e contado a parte: um numero que
  // parece completo e nao e seria pior que numero nenhum.
  const totals = threads.reduce(
    (sum, thread) => ({
      costUsd: thread.costUsd === null ? sum.costUsd : (sum.costUsd ?? 0) + thread.costUsd,
      unknownCostCount: sum.unknownCostCount + thread.unknownCostCount,
      executions: sum.executions + thread.executionCount,
      tokens: sum.tokens + thread.totalTokens,
      durationMs: sum.durationMs + thread.totalDurationMs,
    }),
    {
      costUsd: null as number | null,
      unknownCostCount: 0,
      executions: 0,
      tokens: 0,
      durationMs: 0,
    },
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="flex items-baseline gap-3 border-b border-rule pb-4">
        <Activity className="size-5 text-time" aria-hidden />
        <h1 className="text-xl font-medium">Conversas</h1>
        <p className="text-sm text-ink-muted">
          {threads.length === 1 ? '1 thread' : `${threads.length} threads`}
        </p>
      </header>

      <ThreadFiltersForm filters={filters} />

      {threads.length > 0 ? (
        <section className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-b border-rule pb-5">
          <Metric
            label="Custo real acumulado"
            value={formatUsd(totals.costUsd)}
            tone="spend"
            hint={
              totals.unknownCostCount > 0
                ? `${totals.unknownCostCount} execucoes sem custo informado ficaram de fora`
                : 'todas as execucoes tiveram custo confirmado'
            }
          />
          <Metric label="Respostas" value={String(totals.executions)} />
          <Metric label="Tokens" value={formatTokens(totals.tokens)} />
          <Metric label="Tempo somado" value={formatDuration(totals.durationMs)} tone="time" />
        </section>
      ) : null}

      {threads.length === 0 ? (
        <EmptyState
          title="Nenhuma conversa registrada ainda"
          description="Ligue a telemetria no agente e rode um turno. Cada execucao aparece aqui com o custo real cobrado, o tempo gasto e tudo que entrou e saiu do modelo."
        />
      ) : (
        <ThreadTable threads={threads} />
      )}
    </main>
  );
}
