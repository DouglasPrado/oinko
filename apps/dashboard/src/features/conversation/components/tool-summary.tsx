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
    <section aria-label="Ferramentas disponiveis" className="mt-3">
      <h2 className="flex items-center gap-1.5 text-[0.6875rem] text-ink-muted">
        <Wrench className="size-3" aria-hidden />
        Ferramentas disponiveis
        {used.size === 0 ? <span>· nenhuma foi chamada neste turno</span> : null}
      </h2>

      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {available.map((name) => {
          const count = used.get(name) ?? 0;
          return (
            <li
              key={name}
              className={cn(
                'flex items-baseline gap-1',
                count === 0 ? 'text-ink-muted' : 'font-medium text-ink',
              )}
            >
              <span className="font-mono">{name}</span>
              {count > 0 ? (
                <span className="tabular text-time">
                  {count}
                  {count === 1 ? '×' : '×'}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
