'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import type { ThreadFilters } from '../schemas/thread.schema';

/**
 * Client component porque escreve na URL a partir de eventos do usuario.
 *
 * Os filtros vivem na URL, nao em estado local: recarregar a pagina ou mandar
 * o link para alguem tem que reproduzir a mesma lista.
 */
export function ThreadFiltersForm({ filters }: { filters: ThreadFilters }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(key: string, value: string): void {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);

    startTransition(() => {
      router.replace(next.size > 0 ? `/?${next.toString()}` : '/');
    });
  }

  return (
    <form className="flex flex-wrap items-end gap-4" onSubmit={(event) => event.preventDefault()}>
      <div className="flex flex-col gap-1">
        <label htmlFor="q" className="text-[0.8125rem] text-ink-muted">
          Buscar thread
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={filters.q}
          onChange={(event) => apply('q', event.target.value)}
          placeholder="identificador"
          className="border border-rule bg-surface px-3 py-1.5 text-sm"
          style={{ borderRadius: 'var(--radius-control)' }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="model" className="text-[0.8125rem] text-ink-muted">
          Modelo
        </label>
        <input
          id="model"
          name="model"
          type="search"
          defaultValue={filters.model}
          onChange={(event) => apply('model', event.target.value)}
          placeholder="anthropic/claude"
          className="border border-rule bg-surface px-3 py-1.5 text-sm"
          style={{ borderRadius: 'var(--radius-control)' }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="status" className="text-[0.8125rem] text-ink-muted">
          Situacao
        </label>
        <select
          id="status"
          name="status"
          defaultValue={filters.status}
          onChange={(event) => apply('status', event.target.value)}
          className="border border-rule bg-surface px-3 py-1.5 text-sm"
          style={{ borderRadius: 'var(--radius-control)' }}
        >
          <option value="all">Todas</option>
          <option value="ok">Concluidas</option>
          <option value="error">Com erro</option>
        </select>
      </div>

      <span aria-live="polite" className="pb-2 text-xs text-ink-muted">
        {pending ? 'Filtrando…' : ''}
      </span>
    </form>
  );
}
