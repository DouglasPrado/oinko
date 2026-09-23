import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Metric } from '@/features/projects/workspace-ui';
import { Coins, MessagesSquare, Timer, Layers } from 'lucide-react';
import { notFound } from 'next/navigation';
import { selectTelemetry } from '@/server/repositories/telemetry-sources';
import { listThreads } from '@/server/repositories/thread-repository';
import { ThreadFiltersSchema } from '@/features/threads/schemas/thread.schema';
import { Workbench } from '@/components/shell/workbench';
import { ThreadTable } from '@/features/threads/components/thread-table';
import { ThreadFiltersForm } from '@/features/threads/components/thread-filters-form';
import { EmptyState } from '@/components/shared/empty-state';
import { formatUsd } from '@/lib/utils/format-usd';
import { formatDuration } from '@/lib/utils/format-duration';
import { formatTokens } from '@/lib/utils/format-tokens';

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

  const telemetry = selectTelemetry(typeof params.bot === 'string' ? params.bot : undefined);
  if (!telemetry) notFound();
  const threads = telemetry.database ? listThreads(filters, telemetry.database) : [];

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
    <Workbench showConversations telemetry={telemetry}>
      <div className="grid grid-cols-2 gap-3 p-5 xl:grid-cols-4">
        <Metric
          label="Respostas"
          value={totals.executions}
          icon={<MessagesSquare className="size-4" />}
          hint={`${threads.length} conversas na seleção`}
        />
        <Metric
          label="Custo cobrado"
          value={formatUsd(totals.costUsd)}
          icon={<Coins className="size-4" />}
          hint={
            totals.unknownCostCount
              ? `${totals.unknownCostCount} sem valor informado`
              : 'Valores informados pelo provedor'
          }
        />
        <Metric
          label="Tokens"
          value={formatTokens(totals.tokens)}
          icon={<Layers className="size-4" />}
          hint="Entrada e saída somadas"
        />
        <Metric
          label="Tempo somado"
          value={formatDuration(totals.durationMs)}
          icon={<Timer className="size-4" />}
          hint="Duração das respostas selecionadas"
        />
      </div>

      {totals.executions > 0 && (
        <Card className="mx-5 gap-0 py-0 shadow-none">
          <CardContent className="flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-48 flex-1">
              <div className="mb-2 flex justify-between gap-3 text-sm">
                <span>Respostas sem erro</span>
                <span className="font-medium">
                  {totals.executions - threads.reduce((n, t) => n + t.errorCount, 0)} de{' '}
                  {totals.executions}
                </span>
              </div>
              <Progress
                aria-label="Respostas sem erro"
                value={
                  (100 * (totals.executions - threads.reduce((n, t) => n + t.errorCount, 0))) /
                  totals.executions
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">Totais relativos aos filtros atuais.</p>
          </CardContent>
        </Card>
      )}

      <div className="px-5 py-3">
        <ThreadFiltersForm filters={filters} />
      </div>

      {threads.length === 0 ? (
        <div className="px-5">
          <EmptyState
            title="Nenhuma conversa registrada ainda"
            description={telemetry.emptyMessage}
          />
        </div>
      ) : (
        <ThreadTable threads={threads} botId={telemetry.id} />
      )}
    </Workbench>
  );
}
