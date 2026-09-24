'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { SearchField } from '@/components/shared/search-field';
import { Input } from '@/components/ui/input';
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
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function apply(key: string, value: string): void {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);

    startTransition(() => {
      router.replace(next.size > 0 ? `${pathname}?${next.toString()}` : pathname);
    });
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      role="search"
      aria-label="Filtrar conversas"
      onSubmit={(event) => event.preventDefault()}
    >
      <SearchField
        id="q"
        name="q"
        aria-label="Buscar conversa"
        shortcut="f"
        defaultValue={filters.q}
        onChange={(event) => apply('q', event.target.value)}
        placeholder="Buscar conversa…"
        className="min-w-0 flex-1 basis-60"
      />

      <Input
        id="model"
        name="model"
        type="search"
        aria-label="Modelo"
        defaultValue={filters.model}
        onChange={(event) => apply('model', event.target.value)}
        placeholder="Modelo, ex. anthropic/claude"
        className="w-full font-mono text-[13px]! sm:w-64"
      />

      <select
        id="status"
        name="status"
        aria-label="Situacao"
        defaultValue={filters.status}
        onChange={(event) => apply('status', event.target.value)}
        className="h-9 rounded-full border border-rule-strong bg-canvas pl-3.5 text-sm font-medium text-ink transition-colors hover:bg-hover"
      >
        <option value="all">Todas as situações</option>
        <option value="ok">Concluidas</option>
        <option value="error">Com erro</option>
      </select>

      <span
        aria-live="polite"
        className="inline-flex min-w-20 items-center gap-1.5 text-xs text-ink-muted"
      >
        {pending ? (
          <>
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Filtrando…
          </>
        ) : null}
      </span>
    </form>
  );
}
