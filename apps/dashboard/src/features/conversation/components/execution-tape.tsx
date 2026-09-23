import Link from 'next/link';
import { Brain, Cpu, Plug, Wrench } from 'lucide-react';
import type { TimelineItem } from '../schemas/timeline.schema';
import { formatDuration, formatOffset } from '@/lib/utils/format-duration';
import { formatUsd } from '@/lib/utils/format-usd';
import { formatTokens } from '@/lib/utils/format-tokens';
import { cn } from '@/lib/utils/cn';

const ICON = { llm_call: Cpu, tool_call: Wrench, mcp_call: Plug, decision: Brain };

const TONE: Record<TimelineItem['kind'], string> = {
  llm_call: 'text-time',
  tool_call: 'text-ink',
  mcp_call: 'text-ink',
  decision: 'text-judge',
};

function title(item: TimelineItem): string {
  switch (item.kind) {
    case 'llm_call':
      return `chamada ${item.seq + 1} · ${item.model}`;
    case 'tool_call':
      return item.name;
    case 'mcp_call':
      return `${item.serverName} · ${item.remoteToolName}`;
    case 'decision':
      return item.point;
  }
}

/** Resumo de uma linha: o que muda entre etapas, sem o payload. */
function Facts({ item }: { item: TimelineItem }) {
  if (item.kind === 'llm_call') {
    return (
      <>
        <span className="tabular text-ink-muted">
          {formatTokens(item.inputTokens)}→{formatTokens(item.outputTokens)}
        </span>
        {item.cachedTokens ? (
          <span className="tabular text-ink-muted" title="tokens lidos do cache">
            cache {formatTokens(item.cachedTokens)}
          </span>
        ) : null}
        {item.ttftMs !== null ? (
          <span className="tabular text-time" title="tempo ate o primeiro token">
            ttft {formatDuration(item.ttftMs)}
          </span>
        ) : null}
        <span className="tabular text-spend">{formatUsd(item.costUsd)}</span>
      </>
    );
  }

  if (item.kind === 'tool_call') {
    return (
      <>
        <span className="text-ink-muted">{item.origin}</span>
        {item.isError ? <span className="text-fault">erro</span> : null}
        {item.truncated ? <span className="text-ink-muted">truncado</span> : null}
      </>
    );
  }

  if (item.kind === 'mcp_call') {
    return (
      <>
        {item.timedOut ? <span className="text-fault">tempo esgotado</span> : null}
        {item.isError && !item.timedOut ? <span className="text-fault">erro</span> : null}
      </>
    );
  }

  const [first] = Object.entries(item.answers);
  if (!first) return null;
  const answer = (typeof first[1] === 'object' && first[1] !== null ? first[1] : {}) as {
    value?: unknown;
    confidence?: unknown;
  };
  const value =
    answer.value === true ? 'sim' : answer.value === false ? 'nao' : String(answer.value);

  return (
    <>
      <span className="text-ink-muted">{first[0]}</span>
      <span>{value}</span>
      {typeof answer.confidence === 'number' ? (
        <span className="tabular text-judge">{Math.round(answer.confidence * 100)}%</span>
      ) : null}
    </>
  );
}

interface Props {
  items: TimelineItem[];
  startedAt: number;
  selectedId?: string;
  /** Rota da execucao, para o link que seleciona um item. */
  basePath: string;
}

/**
 * A fita: uma linha por etapa, em ordem, com o tempo relativo a esquerda.
 *
 * Deliberadamente sem payload aqui dentro. Um system prompt de quatro
 * kilobytes empurrava para fora da tela justamente o que varia entre etapas —
 * duracao, tokens, custo, erro. O conteudo abre no inspetor, ao lado, sem
 * trocar de pagina.
 */
export function ExecutionTape({ items, startedAt, selectedId, basePath }: Props) {
  if (items.length === 0) {
    return <p className="px-5 py-4 text-sm text-ink-muted">Nenhuma etapa registrada.</p>;
  }

  return (
    <ol className="border-t border-rule">
      {items.map((item) => {
        const Icon = ICON[item.kind];
        const selected = item.id === selectedId;

        return (
          <li key={item.id}>
            <Link
              href={`${basePath}${basePath.includes('?') ? '&' : '?'}item=${encodeURIComponent(item.id)}`}
              scroll={false}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'flex items-baseline gap-x-4 gap-y-1 border-b border-rule/60 px-5 py-1.5',
                'text-sm hover:bg-surface',
                selected && 'bg-surface',
                selected && 'border-l-2 border-l-time pl-[calc(1.25rem-2px)]',
              )}
            >
              <span className="tabular w-14 shrink-0 font-mono text-xs text-ink-muted">
                {formatOffset(item.startedAt - startedAt)}
              </span>

              <Icon className={cn('size-3.5 shrink-0', TONE[item.kind])} aria-hidden />

              <span className="min-w-0 flex-1 truncate">{title(item)}</span>

              <span className="flex shrink-0 items-baseline gap-4 text-xs">
                <Facts item={item} />
              </span>

              <span className="tabular w-16 shrink-0 text-right text-time">
                {formatDuration(item.durationMs)}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
