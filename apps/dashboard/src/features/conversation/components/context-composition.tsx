import type { Injection } from '../schemas/timeline.schema';
import { formatTokens } from '@/lib/utils/format-tokens';

/** Uma cor por natureza de bloco, estavel entre execucoes. */
const BAND: Record<string, string> = {
  security: '#96262C',
  tools: '#2B6C8F',
  environment: '#5A635E',
  knowledge: '#3F6B3A',
  memory: '#4A4E9C',
  skill: '#8A6A1F',
  mcp: '#7A5C8F',
};

function bandOf(source: string): string {
  const key = Object.keys(BAND).find((prefix) => source.startsWith(prefix));
  return key ? (BAND[key] as string) : '#1B2320';
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

  const applied = injections.filter((injection) => injection.applied);
  const dropped = injections.filter((injection) => !injection.applied);
  const total = applied.reduce((sum, injection) => sum + injection.tokens, 0) || 1;

  return (
    <section aria-labelledby="composition-heading">
      <h2 id="composition-heading" className="text-[0.6875rem] text-ink-muted">
        De que e feito este prompt
      </h2>

      <div className="mt-1.5 flex h-5 w-full overflow-hidden border border-rule">
        {applied.map((injection) => (
          <div
            key={injection.source}
            title={`${injection.source} — ${formatTokens(injection.tokens)} tokens`}
            style={{
              width: `${Math.max((injection.tokens / total) * 100, 0.6)}%`,
              background: bandOf(injection.source),
            }}
          />
        ))}
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {applied.map((injection) => (
          <li key={injection.source} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-2.5"
              style={{ background: bandOf(injection.source) }}
            />
            <span>{injection.source}</span>
            <span className="tabular text-ink-muted">{formatTokens(injection.tokens)}</span>
          </li>
        ))}
      </ul>

      {dropped.length > 0 ? (
        <p className="mt-3 text-[0.8125rem] text-ink-muted">
          Fora do prompt por orcamento de contexto:{' '}
          {dropped
            .map((injection) => `${injection.source} (${formatTokens(injection.tokens)})`)
            .join(', ')}
        </p>
      ) : null}

      {contextTokens !== null ? (
        <p className="tabular mt-2 text-[0.8125rem] text-ink-muted">
          {formatTokens(contextTokens)} tokens de contexto montado
        </p>
      ) : null}
    </section>
  );
}
