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
    <nav aria-label="Conversas" className="min-w-0 px-2 pb-3">
      <div className="flex h-8 items-center gap-2 px-2.5">
        <h2 className="text-xs font-medium text-ink-muted">Conversas</h2>
        <span className="ml-auto">
          <LiveBadge key={telemetry.id} />
        </span>
      </div>

      {threads.length === 0 ? (
        <p className="px-2.5 py-2 text-[13px] text-ink-muted">Nenhuma conversa gravada ainda.</p>
      ) : null}

      <ul className="space-y-px">
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
                  'flex h-10 items-center gap-2 rounded-md px-2.5 text-[13px] transition-colors lg:h-8',
                  open
                    ? 'bg-selected font-medium text-ink'
                    : 'text-ink-muted hover:bg-hover hover:text-ink',
                )}
              >
                <span className="min-w-0 flex-1 truncate" title={threadLabel(thread.threadId)}>
                  {threadLabel(thread.threadId)}
                </span>
                {thread.errorCount > 0 ? (
                  <span
                    className="tabular inline-flex shrink-0 items-center gap-1 text-xs text-error-ink"
                    title={`${thread.errorCount} com erro`}
                  >
                    <span aria-hidden className="size-1.5 rounded-full bg-error" />
                    {thread.errorCount}
                  </span>
                ) : null}
                <span className="tabular shrink-0 text-xs font-normal text-ink-muted">
                  {thread.executionCount}
                </span>
              </Link>

              {open && executions.length > 0 ? (
                <ul className="my-1 ml-4 space-y-px border-l border-rule pl-2">
                  {executions.map((execution) => {
                    const current = execution.traceId === activeTraceId;
                    return (
                      <li key={execution.traceId}>
                        <Link
                          href={telemetryHref(
                            `/threads/${encodeURIComponent(thread.threadId)}/${execution.traceId}`,
                            telemetry.id,
                          )}
                          aria-current={current ? 'page' : undefined}
                          className={cn(
                            'flex h-9 items-center gap-2 rounded-md px-2 text-xs transition-colors lg:h-7',
                            current
                              ? 'bg-selected font-medium text-ink'
                              : 'text-ink-muted hover:bg-hover hover:text-ink',
                          )}
                        >
                          {execution.status === 'error' ? (
                            <>
                              <span
                                aria-hidden
                                className="size-1.5 shrink-0 rounded-full bg-error"
                              />
                              <span className="sr-only">com erro</span>
                            </>
                          ) : null}
                          <span className="tabular shrink-0">
                            {day(execution.startedAt)} {time(execution.startedAt)}
                          </span>
                          <span className="tabular ml-auto shrink-0">
                            {formatDuration(execution.durationMs)}
                          </span>
                          {execution.costUsd !== null ? (
                            <span className="tabular shrink-0 text-ink-subtle">
                              {formatUsd(execution.costUsd)}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
