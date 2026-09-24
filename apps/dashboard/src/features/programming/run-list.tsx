'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListChecks, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot, type StatusTone } from '@/components/shared/status-dot';
import { Blank, listStyle } from '@/features/projects/workspace-ui';
import { cn } from '@/lib/utils/cn';
import { programmingRequest, runHref, shortRunId, stateText, type RunSummary } from './api';

const TONE: Record<string, StatusTone> = {
  queued: 'neutral',
  running: 'ready',
  paused: 'warning',
  blocked: 'error',
  completed: 'ready',
  failed: 'error',
  cancelled: 'neutral',
};
const FILTERS = [
  { id: 'active', label: 'Ativos', states: ['queued', 'running', 'paused', 'blocked'] },
  { id: 'done', label: 'Encerrados', states: ['completed', 'failed', 'cancelled'] },
  { id: 'all', label: 'Todos', states: [] as string[] },
] as const;

export function RunStatus({ run }: { run: Pick<RunSummary, 'state' | 'pendingControls'> }) {
  return (
    <StatusDot
      tone={TONE[run.state] ?? 'neutral'}
      pulse={run.state === 'running' || run.state === 'queued'}
      label={stateText(run)}
      className="text-[13px]!"
    />
  );
}

/** Queue and history of programming runs; refreshes while open. */
export function RunList({ botId }: { botId?: string }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('active');
  const states = FILTERS.find((item) => item.id === filter)!.states;
  const query = useQuery({
    queryKey: ['runs', botId ?? '*', filter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (botId) params.set('botId', botId);
      for (const state of states) params.append('state', state);
      params.set('limit', '50');
      return programmingRequest<{ items: RunSummary[]; nextCursor?: string }>(`/api/runs?${params}`);
    },
    refetchInterval: 2000,
  });
  return (
    <section aria-label="Trabalhos de programação" className="space-y-3">
      <div role="tablist" aria-label="Filtro de trabalhos" className="flex flex-wrap gap-1">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={filter === item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={cn(
              'h-9 rounded-md px-3 text-sm',
              filter === item.id ? 'bg-selected font-medium text-ink' : 'text-ink-muted hover:bg-hover',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {query.error && (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar os trabalhos</AlertTitle>
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      )}
      {query.isPending && (
        <div className={listStyle}>
          {[1, 2].map((n) => (
            <div key={n} className="space-y-2 px-4 py-3.5">
              <Skeleton className="h-3.5 w-64 max-w-full" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      )}
      {query.data && !query.data.items.length && (
        <Blank
          icon={<ListChecks aria-hidden />}
          title="Nenhum trabalho"
          description="Peça um trabalho pelo Telegram, CLI (/tarefa) ou MCP. Ele aparece aqui com fila, progresso e evidências."
        />
      )}
      {query.data && query.data.items.length > 0 && (
        <ul className={listStyle} aria-label="Lista de trabalhos">
          {query.data.items.map((run) => (
            <li key={run.id}>
              <Link
                href={runHref(run.botId, run.id)}
                className="flex flex-col gap-1.5 px-4 py-3.5 transition-colors hover:bg-hover sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium text-ink">{run.request}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                    <span className="font-mono">#{shortRunId(run.id)}</span>
                    {!botId && <span>{run.botId}</span>}
                    <span>
                      {run.projectId}
                      {run.taskId ? ` / ${run.taskId}` : ''}
                    </span>
                    {run.mode === 'analysis' && <Badge variant="secondary">análise</Badge>}
                    {run.queuePosition !== undefined && <span>posição {run.queuePosition + 1} na fila</span>}
                  </p>
                  {run.blocked && (
                    <p className="flex items-start gap-1.5 text-xs text-error-ink">
                      <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      <span className="line-clamp-2">{run.blocked.message}</span>
                    </p>
                  )}
                </div>
                <RunStatus run={run} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
