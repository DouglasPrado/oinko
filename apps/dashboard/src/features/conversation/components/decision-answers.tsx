interface Answer {
  value?: unknown;
  confidence?: unknown;
  probabilities?: Record<string, unknown>;
}

function label(value: unknown): string {
  if (value === true) return 'sim';
  if (value === false) return 'nao';
  return String(value);
}

function percent(confidence: unknown): string | null {
  return typeof confidence === 'number' ? `${Math.round(confidence * 100)}%` : null;
}

/**
 * O que o decisor respondeu, em palavras.
 *
 * Booleano vira sim/nao e confianca vira porcentagem inteira: a resposta crua
 * traz dezesseis casas decimais, e nenhuma delas muda a leitura de quem esta
 * investigando por que o agente decidiu assim.
 */
export function DecisionAnswers({
  answers,
  labels = {},
}: {
  answers: Record<string, unknown>;
  labels?: Record<string, string>;
}) {
  const entries = Object.entries(answers);
  if (entries.length === 0) return null;

  return (
    <dl className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-[0.8125rem] sm:pl-20">
      {entries.map(([key, raw]) => {
        const answer = (typeof raw === 'object' && raw !== null ? raw : {}) as Answer;
        const confidence = percent(answer.confidence);

        return (
          <div key={key} className="flex items-baseline gap-1.5">
            <dt className="text-ink-muted">{labels[key] ?? key}</dt>
            <dd className="font-medium">{label(answer.value)}</dd>
            {confidence ? (
              <dd className="tabular text-judge" title="confianca declarada pelo decisor">
                {confidence}
              </dd>
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}
