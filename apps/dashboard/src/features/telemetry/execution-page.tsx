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

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[0.6875rem] tracking-wide text-ink-muted">{label}</span>
      <span className={`tabular text-lg leading-tight font-medium ${tone ?? ''}`}>{value}</span>
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
      <header className="border-b border-rule px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-base font-medium">{execution.model}</h1>
          <span className="font-mono text-xs text-ink-muted">{execution.traceId}</span>
          {execution.status === 'error' ? (
            <span className="text-xs text-fault">{execution.endReason ?? 'erro'}</span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
          <Stat label="Tempo total" value={formatDuration(execution.durationMs)} tone="text-time" />
          <Stat
            label={
              execution.costStatus === 'confirmed'
                ? 'Custo cobrado'
                : execution.costStatus === 'pending'
                  ? 'Custo aguardando'
                  : 'Custo nao informado'
            }
            value={formatUsd(execution.costUsd)}
            tone="text-spend"
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
            tone={execution.status === 'error' ? 'text-fault' : 'text-ok'}
          />
        </div>

        <RoutingNote
          model={execution.model}
          requestedModel={execution.requestedModel}
          items={detail.items}
        />

        {execution.errorMessage ? (
          <p className="mt-3 border-l-2 border-fault bg-surface px-3 py-1.5 text-sm text-fault">
            {execution.errorMessage}
          </p>
        ) : null}
      </header>

      <div className="px-5 py-4">
        <ContextComposition
          injections={detail.injections}
          contextTokens={execution.contextTokens}
        />
        <ToolSummary available={detail.availableTools} items={detail.items} />
      </div>

      <TurnTranscript userInput={detail.userInput} assistantText={detail.assistantText} />

      <ExecutionTape
        items={detail.items}
        startedAt={execution.startedAt}
        {...(selectedId !== undefined && { selectedId })}
        basePath={basePath}
      />
    </Workbench>
  );
}
