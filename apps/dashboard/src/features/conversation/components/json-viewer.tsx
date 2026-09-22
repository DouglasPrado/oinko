'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { toJsonLines, type TokenKind } from './json-lines';

const TONE: Record<TokenKind, string> = {
  key: 'text-judge',
  string: 'text-ok',
  number: 'text-time',
  boolean: 'text-spend',
  null: 'text-ink-muted',
  punct: 'text-ink-muted',
};

/**
 * JSON como um editor mostra: linha numerada, indentacao guiada e blocos que
 * dobram.
 *
 * A versao anterior resumia cada ramo em "3 campos" e escondia a forma do
 * documento — para conferir o que foi enviado ao modelo e a forma que importa.
 */
export function JsonViewer({ data }: { data: unknown }) {
  const lines = useMemo(() => toJsonLines(data), [data]);
  const [folded, setFolded] = useState<ReadonlySet<number>>(new Set());

  function toggle(index: number): void {
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  // Uma linha some quando esta dentro de um bloco dobrado. O fim do bloco
  // continua visivel, senao o JSON parece truncado em vez de recolhido.
  const hidden = new Set<number>();
  for (const index of folded) {
    const line = lines[index];
    if (line?.closesAt === undefined) continue;
    for (let i = index + 1; i < line.closesAt; i++) hidden.add(i);
  }

  return (
    <div className="overflow-auto font-mono text-xs leading-[1.6]">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, index) => {
            if (hidden.has(index)) return null;
            const foldable = line.closesAt !== undefined;
            const isFolded = folded.has(index);

            return (
              <tr key={index} className="hover:bg-paper/60">
                <td className="w-px pr-3 pl-2 text-right align-top text-ink-muted/70 select-none">
                  {index + 1}
                </td>
                <td className="w-px pr-1 align-top select-none">
                  {foldable ? (
                    <button
                      type="button"
                      onClick={() => toggle(index)}
                      aria-expanded={!isFolded}
                      aria-label={isFolded ? 'Expandir bloco' : 'Recolher bloco'}
                      className="flex text-ink-muted/60 hover:text-time"
                    >
                      {isFolded ? (
                        <ChevronRight className="size-3" aria-hidden />
                      ) : (
                        <ChevronDown className="size-3" aria-hidden />
                      )}
                    </button>
                  ) : null}
                </td>
                <td className="pr-3 whitespace-pre">
                  {Array.from({ length: line.depth }, (_, level) => (
                    <span
                      key={level}
                      aria-hidden
                      className="inline-block w-4 self-stretch border-l border-rule/70"
                    />
                  ))}
                  {line.tokens.map((token, position) => (
                    <span key={position} className={TONE[token.kind]}>
                      {token.text}
                    </span>
                  ))}
                  {isFolded ? <span className="text-ink-muted/70"> … </span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
