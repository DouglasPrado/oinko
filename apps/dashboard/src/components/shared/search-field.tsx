'use client';

import { useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';

function editable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * Busca compacta com lupa a esquerda e, opcionalmente, um atalho de teclado.
 *
 * O atalho so vale fora de campos editaveis e sem modificador: `f` enquanto se
 * digita num formulario tem que continuar sendo a letra f.
 */
export function SearchField({
  shortcut,
  className,
  ...props
}: React.ComponentProps<'input'> & { shortcut?: string }) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!shortcut) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== shortcut.toLowerCase()) return;
      if (event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcut]);

  return (
    <div className={cn('relative w-full', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
        aria-hidden
      />
      <Input ref={input} type="search" className={cn('peer pl-9', shortcut && 'pr-9')} {...props} />
      {shortcut && (
        <kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2 hidden h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-sm border border-rule bg-paper px-1 text-[11px] leading-none text-ink-muted uppercase transition-opacity peer-focus:opacity-0 sm:inline-flex"
        >
          {shortcut}
        </kbd>
      )}
    </div>
  );
}
