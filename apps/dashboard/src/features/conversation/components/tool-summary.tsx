import { Wrench } from 'lucide-react';
import type { TimelineItem } from '../schemas/timeline.schema';
import { cn } from '@/lib/utils/cn';

interface Props {
  available: string[];
  items: TimelineItem[];
}

/**
 * Quais ferramentas o modelo podia chamar, e quais chamou.
 *
 * Sem isto, uma execucao sem nenhuma chamada era ambigua: nao dava para saber
 * se o agente decidiu nao usar ferramenta, se nao havia nenhuma registrada, ou
 * se a interface simplesmente nao mostrava.
 */
export function ToolSummary({ available, items }: Props) {
  if (available.length === 0) return null;

  const used = new Map<string, number>();
  for (const item of items) {
    if (item.kind !== 'tool_call') continue;
    used.set(item.name, (used.get(item.name) ?? 0) + 1);
  }

  return (
    <section aria-label="Ferramentas disponiveis">
      <h2 className="flex flex-wrap items-center gap-x-1.5 text-[13px] font-medium">
        <Wrench className="size-3.5 text-ink-muted" aria-hidden />
        Ferramentas disponiveis
        {used.size === 0 ? (
          <span className="font-normal text-ink-muted">· nenhuma foi chamada neste turno</span>
        ) : null}
      </h2>

      <ul className="mt-2 flex flex-wrap gap-1.5">
        {available.map((name) => {
          const count = used.get(name) ?? 0;
          return (
            <li
              key={name}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs',
                count === 0
                  ? 'border-rule text-ink-muted'
                  : 'border-rule-strong bg-canvas font-medium text-ink',
              )}
            >
              <span className="font-mono">{name}</span>
              {count > 0 ? (
                <span className="tabular rounded-full bg-hover px-1.5 text-[11px] leading-4 font-normal text-ink-muted">
                  {count}×
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
