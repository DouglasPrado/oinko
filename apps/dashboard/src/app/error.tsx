'use client';

import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-xl border border-rule p-6">
        <span className="mb-4 flex size-10 items-center justify-center rounded-xl border border-rule text-warning-ink">
          <TriangleAlert className="size-4" aria-hidden />
        </span>
        <h1 className="text-xl leading-[1.3] font-semibold tracking-[-0.3px]">
          A tela nao carregou
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Não foi possível ler os dados do bot selecionado. Confira se o bot está configurado e
          tente novamente.
        </p>
        <Button type="button" variant="outline" onClick={reset} className="mt-5">
          Tentar de novo
        </Button>
      </div>
    </main>
  );
}
