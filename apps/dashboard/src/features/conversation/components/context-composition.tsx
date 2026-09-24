import type { Injection } from '../schemas/timeline.schema';
import { formatTokens } from '@/lib/utils/format-tokens';

/**
 * Uma cor por natureza de bloco, estavel entre execucoes, na ordem fixa da
 * paleta categorica validada (daltonismo e visao normal, fatias adjacentes).
 * A legenda sempre nomeia a fonte e os tokens: cor nunca e a unica pista.
 */
const BAND: [prefix: string, color: string][] = [
  ['tools', '#2a78d6'],
  ['security', '#eb6834'],
  ['knowledge', '#1baf7a'],
  ['skill', '#eda100'],
  ['memory', '#e87ba4'],
  ['environment', '#008300'],
  ['mcp', '#4a3aa7'],
  ['history', '#2a8791'],
  ['context:summary', '#9960a5'],
];

const LABELS: Record<string, string> = {
  'system:base': 'Instruções do bot',
  'tools:schema': 'Definições das ferramentas',
  'history:recent': 'Histórico recente',
  'history:archived_details': 'Trechos recuperados do histórico',
  'context:summary': 'Resumo da conversa',
  'tools:discovery': 'Descoberta de ferramentas',
};

function slotOf(source: string): number {
  const index = BAND.findIndex(([prefix]) => source.startsWith(prefix));
  return index === -1 ? BAND.length : index;
}

function bandOf(source: string): string {
  return BAND[slotOf(source)]?.[1] ?? '#8f8f8f';
}

interface Props {
  injections: Injection[];
  contextTokens: number | null;
}

/**
 * De que e feito o prompt que foi realmente enviado.
 *
 * E a peca que responde por que a resposta custou o que custou: cada bloco
 * injetado, sua fonte e quantos tokens ocupou. Os blocos que o orcamento
 * descartou aparecem vazados, porque "a skill nao entrou no prompt" e
 * normalmente a explicacao que se procura.
 */
export function ContextComposition({ injections, contextTokens }: Props) {
  if (injections.length === 0) return null;

  // Fatias na ordem da paleta, nao na de injecao: assim as vizinhas sao
  // sempre pares que a validacao de contraste cobriu.
  const applied = injections
    .filter((injection) => injection.applied)
    .sort((a, b) => slotOf(a.source) - slotOf(b.source));
  const dropped = injections.filter((injection) => !injection.applied);
  const total = applied.reduce((sum, injection) => sum + injection.tokens, 0) || 1;

  return (
    <section
      aria-labelledby="composition-heading"
      className="rounded-xl border border-rule px-4 py-3.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="composition-heading" className="text-[13px] font-medium">
          De que e feito este prompt
        </h2>
        {contextTokens !== null ? (
          <p className="tabular text-xs text-ink-muted">
            {formatTokens(contextTokens)} tokens estimados de contexto
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
        {applied.map((injection) => (
          <div
            key={injection.source}
            className="h-full first:rounded-l-full last:rounded-r-full"
            title={`${injection.source} — ${formatTokens(injection.tokens)} tokens`}
            style={{
              width: `${Math.max((injection.tokens / total) * 100, 0.6)}%`,
              background: bandOf(injection.source),
            }}
          />
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
        {applied.map((injection) => (
          <li key={injection.source} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-2 rounded-full"
              style={{ background: bandOf(injection.source) }}
            />
            <span className="text-ink">{LABELS[injection.source] ?? injection.source}</span>
            <span className="tabular text-ink-muted">{formatTokens(injection.tokens)}</span>
          </li>
        ))}
      </ul>

      {dropped.length > 0 ? (
        <p className="mt-3 border-t border-rule pt-2.5 text-xs text-ink-muted">
          Fora do prompt por orcamento de contexto:{' '}
          {dropped.map((injection, index) => (
            <span key={injection.source}>
              {index > 0 ? ', ' : ''}
              <span className="font-mono text-ink">{injection.source}</span> (
              {formatTokens(injection.tokens)})
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}
