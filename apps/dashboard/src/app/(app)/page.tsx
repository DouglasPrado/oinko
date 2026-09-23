import { listThreads } from '@/server/repositories/thread-repository';
import { ThreadFiltersSchema } from '@/features/threads/schemas/thread.schema';
import { Workbench } from '@/components/shell/workbench';
import { ThreadTable } from '@/features/threads/components/thread-table';
import { ThreadFiltersForm } from '@/features/threads/components/thread-filters-form';
import { EmptyState } from '@/components/shared/empty-state';
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
    <Workbench showConversations>
      <header className="flex flex-wrap items-baseline gap-x-8 gap-y-3 border-b border-rule px-5 py-4">
        <div className="flex flex-col">
          <span className="text-[0.6875rem] text-ink-muted">
            {totals.unknownCostCount > 0
              ? `Custo cobrado · ${totals.unknownCostCount} sem valor informado`
              : 'Custo cobrado'}
          </span>
          <span className="tabular text-lg leading-tight font-medium text-spend">
            {formatUsd(totals.costUsd)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[0.6875rem] text-ink-muted">Respostas</span>
          <span className="tabular text-lg leading-tight font-medium">{totals.executions}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[0.6875rem] text-ink-muted">Tokens</span>
          <span className="tabular text-lg leading-tight font-medium">
            {formatTokens(totals.tokens)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[0.6875rem] text-ink-muted">Tempo somado</span>
          <span className="tabular text-lg leading-tight font-medium text-time">
            {formatDuration(totals.durationMs)}
          </span>
        </div>
      </header>

      <div className="px-5 py-3">
        <ThreadFiltersForm filters={filters} />
      </div>

      {threads.length === 0 ? (
        <div className="px-5">
          <EmptyState
            title="Nenhuma conversa registrada ainda"
            description="Ligue a telemetria no agente e rode um turno. Cada resposta aparece aqui com o custo cobrado, o tempo gasto e tudo que entrou e saiu do modelo."
          />
        </div>
      ) : (
        <ThreadTable threads={threads} />
      )}
    </Workbench>
  );
}
