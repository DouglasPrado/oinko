'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-medium">A tela nao carregou</h1>
      <p className="mt-3 text-sm text-ink-muted">
        A leitura do banco de telemetria falhou. Confira se o caminho em TELEMETRY_DB_PATH aponta
        para o arquivo que o agente escreve e se ao menos um turno ja rodou com a telemetria ligada.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 border border-rule bg-surface px-4 py-2 text-sm hover:bg-paper"
        style={{ borderRadius: 'var(--radius-control)' }}
      >
        Tentar de novo
      </button>
    </main>
  );
}
