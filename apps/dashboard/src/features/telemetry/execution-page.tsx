import { selectTelemetry } from '@/server/repositories/telemetry-sources';
import { telemetryHref } from '@/features/telemetry/telemetry-href';
import { notFound } from 'next/navigation';
import { getExecutionDetail } from '@/server/repositories/execution-repository';
import { Workbench } from '@/components/shell/workbench';
import { ContextComposition } from '@/features/conversation/components/context-composition';
import { ExecutionTape } from '@/features/conversation/components/execution-tape';
import { ToolSummary } from '@/features/conversation/components/tool-summary';
import { RoutingNote } from '@/features/conversation/components/routing-note';
import { Inspector } from '@/features/conversation/components/inspector';
import { TurnTranscript } from '@/features/conversation/components/turn-transcript';
import { formatUsd } from '@/lib/utils/format-usd';
import { formatDuration } from '@/lib/utils/format-duration';
import { formatTokens } from '@/lib/utils/format-tokens';
import { Badge } from '@/components/ui/badge';
import { CircleAlert } from 'lucide-react';

function Stat({ label, value, tone }: { label: string; value: string; tone?: string | undefined }) {
  return (
    <div className="min-w-0 bg-canvas px-4 py-3">
      <div className="truncate text-xs text-ink-muted">{label}</div>
      <div className={`tabular mt-1 truncate text-base leading-snug font-semibold ${tone ?? ''}`}>
        {value}
      </div>
    </div>
  );
}

export default async function ExecutionPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string; traceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { threadId, traceId } = await params;
  const query = await searchParams;
  const telemetry = selectTelemetry(typeof query.bot === 'string' ? query.bot : undefined);
  if (!telemetry?.database) notFound();
  const detail = getExecutionDetail(traceId, telemetry.database);
  if (!detail) notFound();

  const decoded = decodeURIComponent(threadId);
  if (detail.execution.threadId !== decoded) notFound();
  const basePath = telemetryHref(
    `/threads/${encodeURIComponent(decoded)}/${traceId}`,
    telemetry.id,
  );
  const selectedId = typeof query.item === 'string' ? query.item : undefined;
  const { execution } = detail;

  return (
    <Workbench
      showConversations
      telemetry={telemetry}
      activeThreadId={decoded}
      activeTraceId={traceId}
      inspector={
        <Inspector
          detail={detail}
          {...(selectedId !== undefined && { selectedId })}
          basePath={basePath}
        />
      }
    >
      <div className="space-y-5 px-4 py-6 md:px-6">
        <section aria-labelledby="execution-heading" className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2
              id="execution-heading"
              className="truncate font-mono text-base leading-[1.4] font-medium tracking-[-0.1px]"
            >
              {execution.model}
            </h2>
            {execution.status === 'error' ? (
              <Badge variant="destructive">{execution.endReason ?? 'erro'}</Badge>
            ) : null}
            <span
              className="min-w-0 truncate font-mono text-xs text-ink-muted"
              title={execution.traceId}
            >
              {execution.traceId}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-rule bg-rule sm:grid-cols-3 2xl:grid-cols-6">
            <Stat label="Tempo total" value={formatDuration(execution.durationMs)} />
            <Stat
              label={
                execution.costStatus === 'confirmed'
                  ? 'Custo cobrado'
                  : execution.costStatus === 'pending'
                    ? 'Custo aguardando'
                    : 'Custo nao informado'
              }
              value={formatUsd(execution.costUsd)}
            />
            <Stat label="Tokens" value={formatTokens(execution.totalTokens)} />
            <Stat
              label="Entrada / saida"
              value={`${formatTokens(execution.inputTokens)} / ${formatTokens(execution.outputTokens)}`}
            />
            <Stat label="Etapas" value={String(detail.items.length)} />
            <Stat
              label="Fim"
              value={execution.endReason ?? execution.status}
              tone={execution.status === 'error' ? 'text-error-ink' : undefined}
            />
          </div>

          <RoutingNote
            model={execution.model}
            requestedModel={execution.requestedModel}
            items={detail.items}
          />

          {execution.errorMessage ? (
            <p
              role="alert"
              className="flex gap-2 rounded-xl border border-error/40 bg-canvas px-3 py-2.5 text-[13px] text-error-ink"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {execution.errorMessage}
            </p>
          ) : null}
        </section>

        <ContextComposition
          injections={detail.injections}
          contextTokens={execution.contextTokens}
        />
        <ToolSummary available={detail.availableTools} items={detail.items} />

        <TurnTranscript userInput={detail.userInput} assistantText={detail.assistantText} />

        <ExecutionTape
          items={detail.items}
          startedAt={execution.startedAt}
          {...(selectedId !== undefined && { selectedId })}
          basePath={basePath}
        />
      </div>
    </Workbench>
  );
}
