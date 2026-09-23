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
        Não foi possível ler os dados do bot selecionado. Confira se o bot está configurado e tente
        novamente.
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
