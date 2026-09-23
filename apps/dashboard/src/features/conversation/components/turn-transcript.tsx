import type { PayloadRef } from '../schemas/timeline.schema';

function Bubble({ who, payload, tone }: { who: string; payload: PayloadRef | null; tone: string }) {
  if (!payload || payload.sizeBytes === 0) return null;

  return (
    <div className="border-b border-rule/60 px-5 py-3">
      <p className={`text-[0.6875rem] ${tone}`}>{who}</p>
      <p className="mt-1 max-w-[70ch] text-sm leading-relaxed whitespace-pre-wrap">
        {payload.preview}
        {payload.preview.length < payload.sizeBytes ? '…' : ''}
      </p>
    </div>
  );
}

/**
 * O turno em palavras: o que a pessoa pediu e o que o agente respondeu.
 *
 * A fita conta como a resposta foi produzida; isto conta o que ela foi. Sem
 * este par, a tela de uma execucao simples — uma chamada, nenhuma ferramenta —
 * ficava sendo so uma linha de metricas.
 */
export function TurnTranscript({
  userInput,
  assistantText,
}: {
  userInput: PayloadRef | null;
  assistantText: PayloadRef | null;
}) {
  if (!userInput && !assistantText) return null;

  return (
    <section aria-label="Transcricao do turno" className="border-t border-rule">
      <Bubble who="Pessoa" payload={userInput} tone="text-ink-muted" />
      <Bubble who="Agente" payload={assistantText} tone="text-time" />
    </section>
  );
}
