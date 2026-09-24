import Link from 'next/link';
import { Brain, Cpu, Plug, Wrench } from 'lucide-react';
import type { TimelineItem } from '../schemas/timeline.schema';
import { formatDuration, formatOffset } from '@/lib/utils/format-duration';
import { formatUsd } from '@/lib/utils/format-usd';
import { formatTokens } from '@/lib/utils/format-tokens';
import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';

const ICON = { llm_call: Cpu, tool_call: Wrench, mcp_call: Plug, decision: Brain };

const KIND: Record<TimelineItem['kind'], string> = {
  llm_call: 'chamada ao modelo',
  tool_call: 'ferramenta',
  mcp_call: 'MCP',
  decision: 'decisao',
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
          <span className="tabular text-ink-muted" title="tempo ate o primeiro token">
            ttft {formatDuration(item.ttftMs)}
          </span>
        ) : null}
        <span className="tabular text-ink">{formatUsd(item.costUsd)}</span>
      </>
    );
  }

  if (item.kind === 'tool_call') {
    return (
      <>
        <span className="text-ink-muted">{item.origin}</span>
        {item.isError ? <Badge variant="destructive">erro</Badge> : null}
        {item.truncated ? <Badge variant="secondary">truncado</Badge> : null}
      </>
    );
  }

  if (item.kind === 'mcp_call') {
    return (
      <>
        {item.timedOut ? <Badge variant="destructive">tempo esgotado</Badge> : null}
        {item.isError && !item.timedOut ? <Badge variant="destructive">erro</Badge> : null}
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
      <span className="font-medium text-ink">{value}</span>
      {typeof answer.confidence === 'number' ? (
        <span className="tabular text-ink-muted">{Math.round(answer.confidence * 100)}%</span>
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
    return (
      <p className="rounded-xl border border-dashed border-rule-strong px-4 py-6 text-center text-sm text-ink-muted">
        Nenhuma etapa registrada.
      </p>
    );
  }

  return (
    <section
      aria-labelledby="tape-heading"
      className="overflow-hidden rounded-xl border border-rule"
    >
      <div className="flex h-10 items-center gap-2 border-b border-rule bg-paper px-4">
        <h2 id="tape-heading" className="text-[13px] font-medium">
          Etapas
        </h2>
        <span className="tabular text-xs text-ink-muted">{items.length}</span>
        <span className="ml-auto hidden text-xs text-ink-muted sm:block">
          Escolha uma etapa para abrir no inspetor
        </span>
      </div>
      <ol className="divide-y divide-rule">
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
                  'flex min-h-11 flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-sm transition-colors sm:flex-nowrap',
                  selected
                    ? 'bg-selected shadow-[inset_2px_0_0_var(--color-focus)]'
                    : 'hover:bg-hover',
                )}
              >
                <span className="tabular w-14 shrink-0 font-mono text-xs text-ink-muted">
                  {formatOffset(item.startedAt - startedAt)}
                </span>

                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-md border border-rule bg-canvas',
                    item.kind === 'llm_call' ? 'text-ink' : 'text-ink-muted',
                  )}
                  title={KIND[item.kind]}
                >
                  <Icon className="size-3.5" aria-hidden />
                </span>

                <span className="min-w-0 flex-1 truncate">{title(item)}</span>

                {/* No celular os fatos descem para a segunda linha: o titulo e o que identifica a etapa. */}
                <span className="order-last flex basis-full flex-wrap items-center gap-x-3 gap-y-0.5 pl-[6.5rem] text-xs whitespace-nowrap sm:order-none sm:basis-auto sm:flex-nowrap sm:pl-0">
                  <Facts item={item} />
                </span>

                <span className="tabular w-16 shrink-0 text-right text-[13px] text-ink">
                  {formatDuration(item.durationMs)}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
