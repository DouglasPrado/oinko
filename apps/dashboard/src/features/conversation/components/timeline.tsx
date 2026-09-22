import { Brain, Cpu, Plug, Wrench } from 'lucide-react';
import type { TimelineItem } from '../schemas/timeline.schema';
import { PayloadViewer } from './payload-viewer';
import { DecisionAnswers } from './decision-answers';
import { formatDuration, formatOffset } from '@/lib/utils/format-duration';
import { formatUsd } from '@/lib/utils/format-usd';
import { formatTokens } from '@/lib/utils/format-tokens';

const ICON = { llm_call: Cpu, tool_call: Wrench, mcp_call: Plug, decision: Brain };

function Row({
  offset,
  icon,
  title,
  meta,
  children,
  tone,
}: {
  offset: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  meta: React.ReactNode;
  children?: React.ReactNode;
  tone?: string;
}) {
  return (
    <li className="border-b border-rule/60 py-3" style={{ contentVisibility: 'auto' }}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="tabular w-16 shrink-0 font-mono text-xs text-ink-muted">{offset}</span>
        <span className="flex items-center gap-2" style={{ color: tone }}>
          {icon}
          <span className="text-sm font-medium">{title}</span>
        </span>
        <span className="ml-auto flex flex-wrap items-baseline gap-x-4 text-sm">{meta}</span>
      </div>
      {children}
    </li>
  );
}

/**
 * A fita: cada etapa da resposta em ordem, com o tempo relativo a esquerda e
 * os numeros alinhados a direita. Sem cartao e sem sombra — e registro
 * continuo, nao uma colecao de objetos.
 */
export function Timeline({ items, startedAt }: { items: TimelineItem[]; startedAt: number }) {
  return (
    <ol className="mt-4">
      {items.map((item) => {
        const Icon = ICON[item.kind];
        const offset = formatOffset(item.startedAt - startedAt);

        if (item.kind === 'llm_call') {
          return (
            <Row
              key={item.id}
              offset={offset}
              tone="var(--color-time)"
              icon={<Icon className="size-4" aria-hidden />}
              title={`Chamada ${item.seq + 1} · ${item.model}`}
              meta={
                <>
                  {item.ttftMs !== null ? (
                    <span className="tabular text-time" title="tempo ate o primeiro token">
                      TTFT {formatDuration(item.ttftMs)}
                    </span>
                  ) : null}
                  <span className="tabular text-time">{formatDuration(item.durationMs)}</span>
                  <span className="tabular text-ink-muted">
                    {formatTokens(item.inputTokens)} / {formatTokens(item.outputTokens)} tok
                  </span>
                  <span className="tabular text-spend" title={item.costStatus}>
                    {formatUsd(item.costUsd)}
                  </span>
                </>
              }
            >
              {item.costStatus === 'unavailable' ? (
                <p className="mt-1 pl-20 text-xs text-ink-muted">
                  O provedor nao informou custo para esta chamada. Nada e estimado aqui.
                </p>
              ) : null}
              <div className="pl-0 sm:pl-20">
                <PayloadViewer label="Entrada" payload={item.request} />
                <PayloadViewer label="Saida" payload={item.response} />
              </div>
            </Row>
          );
        }

        if (item.kind === 'tool_call') {
          return (
            <Row
              key={item.id}
              offset={offset}
              tone={item.isError ? 'var(--color-fault)' : 'var(--color-ink)'}
              icon={<Icon className="size-4" aria-hidden />}
              title={`${item.name}`}
              meta={
                <>
                  <span className="text-ink-muted">{item.origin}</span>
                  {item.isError ? <span className="text-fault">erro</span> : null}
                  {item.truncated ? <span className="text-ink-muted">truncado</span> : null}
                  <span className="tabular text-time">{formatDuration(item.durationMs)}</span>
                </>
              }
            >
              <div className="pl-0 sm:pl-20">
                <PayloadViewer label="Argumentos" payload={item.args} />
                <PayloadViewer label="Resultado" payload={item.result} />
              </div>
            </Row>
          );
        }

        if (item.kind === 'mcp_call') {
          return (
            <Row
              key={item.id}
              offset={offset}
              tone={item.isError ? 'var(--color-fault)' : 'var(--color-ink)'}
              icon={<Icon className="size-4" aria-hidden />}
              title={`${item.serverName} · ${item.remoteToolName}`}
              meta={
                <>
                  {item.timedOut ? <span className="text-fault">tempo esgotado</span> : null}
                  <span className="tabular text-time">{formatDuration(item.durationMs)}</span>
                </>
              }
            >
              <div className="pl-0 sm:pl-20">
                <PayloadViewer label="Entrada do MCP" payload={item.request} />
                <PayloadViewer label="Saida do MCP" payload={item.response} />
              </div>
            </Row>
          );
        }

        return (
          <Row
            key={item.id}
            offset={offset}
            tone="var(--color-judge)"
            icon={<Icon className="size-4" aria-hidden />}
            title={`Decisao · ${item.point}`}
            meta={<span className="tabular text-time">{formatDuration(item.durationMs)}</span>}
          >
            <DecisionAnswers answers={item.answers} />
          </Row>
        );
      })}
    </ol>
  );
}
