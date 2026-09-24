import type { PayloadRef } from '../schemas/timeline.schema';

function Bubble({ who, payload, tone }: { who: string; payload: PayloadRef | null; tone: string }) {
  if (!payload || payload.sizeBytes === 0) return null;

  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-4">
      <p className={`text-xs font-medium ${tone}`}>{who}</p>
      <p className="max-w-[72ch] text-sm leading-relaxed whitespace-pre-wrap">
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
    <section
      aria-label="Transcricao do turno"
      className="divide-y divide-rule overflow-hidden rounded-xl border border-rule"
    >
      <Bubble who="Pessoa" payload={userInput} tone="text-ink-muted" />
      <Bubble who="Agente" payload={assistantText} tone="text-ink" />
    </section>
  );
}
