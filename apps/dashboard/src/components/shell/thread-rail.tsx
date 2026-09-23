import { threadLabel } from '@/features/telemetry/thread-label';
import type { TelemetrySelection } from '@/server/repositories/telemetry-sources';
import { telemetryHref } from '@/features/telemetry/telemetry-href';
import Link from 'next/link';
import { navThreads, navExecutions } from '@/server/repositories/navigation-repository';
import { LiveBadge } from '@/features/live/components/live-badge';
import { formatDuration } from '@/lib/utils/format-duration';
import { formatUsd } from '@/lib/utils/format-usd';
import { cn } from '@/lib/utils/cn';

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function day(ms: number): string {
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

interface Props {
  telemetry: TelemetrySelection;
  activeThreadId?: string;
  activeTraceId?: string;
}

/**
 * Barra lateral permanente: conversas e, sob a aberta, suas respostas.
 *
 * Fica disponível nas telas de telemetria. Inspecionar telemetria e pular
 * de uma resposta para a vizinha o tempo todo — comparando tempo, custo e o
 * que mudou —, e uma navegacao que troca de pagina a cada passo perde
 * justamente esse contexto.
 */
export function ThreadRail({ activeThreadId, activeTraceId, telemetry }: Props) {
  const threads = telemetry.database ? navThreads(60, telemetry.database) : [];
  const executions =
    activeThreadId && telemetry.database
      ? navExecutions(activeThreadId, 100, telemetry.database)
      : [];

  return (
    <nav aria-label="Conversas" className="min-w-0 py-3">
      <div className="flex items-center gap-2 px-5 pb-2">
        <h2 className="text-xs font-medium text-ink-muted">Conversas</h2>
        <span className="ml-auto">
          <LiveBadge key={telemetry.id} />
        </span>
      </div>

      {threads.length === 0 ? (
        <p className="px-4 py-4 text-[0.8125rem] text-ink-muted">Nenhuma conversa gravada ainda.</p>
      ) : null}

      <ul>
        {threads.map((thread) => {
          const open = thread.threadId === activeThreadId;

          return (
            <li key={threadLabel(thread.threadId)}>
              <Link
                href={telemetryHref(
                  `/threads/${encodeURIComponent(thread.threadId)}`,
                  telemetry.id,
                )}
                aria-current={open ? 'true' : undefined}
                className={cn(
                  'flex items-baseline gap-2 px-4 py-2 text-[0.8125rem] hover:bg-paper',
                  open && 'bg-paper font-medium',
                )}
              >
                <span className="min-w-0 flex-1 truncate" title={threadLabel(thread.threadId)}>
                  {threadLabel(thread.threadId)}
                </span>
                <span className="tabular ml-auto shrink-0 text-xs text-ink-muted">
                  {thread.executionCount}
                </span>
                {thread.errorCount > 0 ? (
                  <span className="tabular shrink-0 text-xs text-fault">{thread.errorCount}</span>
                ) : null}
              </Link>

              {open && executions.length > 0 ? (
                <ul className="border-y border-rule/60 bg-paper/60 pb-1">
                  {executions.map((execution) => (
                    <li key={execution.traceId}>
                      <Link
                        href={telemetryHref(
                          `/threads/${encodeURIComponent(thread.threadId)}/${execution.traceId}`,
                          telemetry.id,
                        )}
                        aria-current={execution.traceId === activeTraceId ? 'page' : undefined}
                        className={cn(
                          'flex items-baseline gap-2 py-1 pr-3 pl-6 text-xs hover:bg-surface',
                          execution.traceId === activeTraceId &&
                            'border-l-2 border-time bg-surface pl-[calc(1.5rem-2px)] font-medium',
                        )}
                      >
                        <span className="tabular shrink-0 text-ink-muted">
                          {day(execution.startedAt)} {time(execution.startedAt)}
                        </span>
                        <span className="tabular ml-auto shrink-0 text-time">
                          {formatDuration(execution.durationMs)}
                        </span>
                        {execution.costUsd !== null ? (
                          <span className="tabular shrink-0 text-spend">
                            {formatUsd(execution.costUsd)}
                          </span>
                        ) : null}
                        {execution.status === 'error' ? (
                          <span className="shrink-0 text-fault">!</span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
