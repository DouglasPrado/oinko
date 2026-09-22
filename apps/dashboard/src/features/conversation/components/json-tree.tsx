'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/** Quantos niveis ja vem abertos. Alem disso, o usuario abre o que quiser. */
const OPEN_DEPTH = 2;

function Scalar({ value }: { value: unknown }) {
  if (typeof value === 'string') {
    return <span className="break-all whitespace-pre-wrap text-ok">&quot;{value}&quot;</span>;
  }
  if (typeof value === 'number') return <span className="tabular text-time">{value}</span>;
  if (typeof value === 'boolean') return <span className="text-judge">{String(value)}</span>;
  if (value === null) return <span className="text-ink-muted">null</span>;
  // undefined, funcao, symbol: nao vem de JSON.parse, mas o tipo permite.
  return <span className="text-ink-muted">{typeof value}</span>;
}

function summary(value: unknown[] | Record<string, unknown>): string {
  return Array.isArray(value)
    ? `${value.length} ${value.length === 1 ? 'item' : 'itens'}`
    : `${Object.keys(value).length} campos`;
}

function Node({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const branch = typeof value === 'object' && value !== null;
  const [open, setOpen] = useState(depth < OPEN_DEPTH);

  if (!branch) {
    return (
      <div className="flex gap-2 py-px">
        {name === undefined ? null : <span className="shrink-0 text-ink-muted">{name}</span>}
        <Scalar value={value} />
      </div>
    );
  }

  const entries: (readonly [string, unknown])[] = Array.isArray(value)
    ? (value as unknown[]).map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);

  return (
    <div className="py-px">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        className="flex items-center gap-1 hover:text-time"
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-3 shrink-0" aria-hidden />
        )}
        {name === undefined ? null : <span className="text-ink-muted">{name}</span>}
        <span className="text-xs text-ink-muted">
          {Array.isArray(value) ? '[ ]' : '{ }'} {summary(value as never)}
        </span>
      </button>

      {open ? (
        <div className={cn('border-l border-rule pl-3', depth > 0 && 'ml-1')}>
          {entries.map(([key, item]) => (
            <Node key={key} name={key} value={item} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Leitor de JSON com ramos que abrem e fecham.
 *
 * Sem biblioteca de realce: Shiki ou Prism re-tokenizariam duzentos kilobytes
 * na thread principal, que e pior que o problema que resolvem. Aqui o custo e
 * proporcional ao que esta aberto, e os dois primeiros niveis bastam para ver
 * a forma do payload.
 */
export function JsonTree({ data }: { data: unknown }) {
  return (
    <div className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
      <Node value={data} depth={0} />
    </div>
  );
}
