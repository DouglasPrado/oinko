'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  description?: string;
  leaving: boolean;
}

/*
 * Fila de avisos fora do React: qualquer acao chama toast() sem precisar de
 * hook nem de provider no caminho, e o Toaster montado uma vez na raiz desenha.
 */
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const SERVER_SNAPSHOT: ToastItem[] = [];

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tres visiveis bastam; o que passa disso ja nao seria lido. */
const LIMIT = 3;
const DURATION: Record<Tone, number> = { success: 4500, info: 4500, error: 8000 };
const EXIT_MS = 150;

function push(tone: Tone, title: string, description?: string): void {
  items = [
    ...items.slice(-(LIMIT - 1)),
    { id: nextId++, tone, title, ...(description ? { description } : {}), leaving: false },
  ];
  emit();
}

function dismiss(id: number): void {
  if (!items.some((item) => item.id === id && !item.leaving)) return;
  items = items.map((item) => (item.id === id ? { ...item, leaving: true } : item));
  emit();
  setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, EXIT_MS);
}

export const toast = {
  success: (title: string, description?: string) => push('success', title, description),
  error: (title: string, description?: string) => push('error', title, description),
  info: (title: string, description?: string) => push('info', title, description),
};

const ICON = {
  success: <CircleCheck className="size-4 text-ready-ink" aria-hidden />,
  error: <CircleAlert className="size-4 text-error-ink" aria-hidden />,
  info: <Info className="size-4 text-ink-muted" aria-hidden />,
};

/** Um aviso: conta o proprio tempo e pausa enquanto o ponteiro esta em cima. */
function ToastCard({ item }: { item: ToastItem }) {
  const remaining = useRef(DURATION[item.tone]);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    started.current = Date.now();
    timer.current = setTimeout(() => dismiss(item.id), remaining.current);
    return () => clearTimeout(timer.current);
  }, [item.id]);

  return (
    <li
      // Erro interrompe o leitor de tela; o resto entra pela regiao educada.
      {...(item.tone === 'error' && { role: 'alert' })}
      onPointerEnter={() => {
        clearTimeout(timer.current);
        remaining.current -= Date.now() - started.current;
      }}
      onPointerLeave={() => {
        started.current = Date.now();
        timer.current = setTimeout(() => dismiss(item.id), remaining.current);
      }}
      className={cn(
        'pointer-events-auto relative flex w-full items-start gap-3 rounded-2xl border bg-canvas py-3 pr-10 pl-3.5 text-ink shadow-float',
        item.leaving
          ? 'animate-out fade-out-0 duration-150'
          : 'animate-in fade-in-0 slide-in-from-bottom-2 duration-200',
        item.tone === 'error' ? 'border-error/40' : 'border-rule',
      )}
    >
      <span className="mt-0.5 shrink-0">{ICON[item.tone]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-5 font-medium">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-[13px] leading-[1.45] break-words text-ink-muted">
            {item.description}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label="Fechar notificação"
        onClick={() => dismiss(item.id)}
        className="absolute top-2.5 right-2.5 flex size-6 items-center justify-center rounded-sm text-ink-subtle transition-colors hover:bg-hover hover:text-ink"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}

/**
 * Avisos no canto inferior direito, empilhados, o mais novo embaixo.
 *
 * Sem camada de Escape de proposito: com um aviso na tela, Escape tem que
 * continuar fechando a gaveta ou o dialogo que a pessoa esta usando. A area
 * vazia nao captura clique no que esta atras dela.
 */
export function Toaster() {
  const list = useSyncExternalStore(
    subscribe,
    () => items,
    () => SERVER_SNAPSHOT,
  );
  return (
    <section
      aria-label="Notificações"
      aria-live="polite"
      className="pointer-events-none fixed right-0 bottom-0 z-[100] w-full p-4 sm:max-w-sm"
    >
      <ol className="flex flex-col gap-2">
        {list.map((item) => (
          <ToastCard key={item.id} item={item} />
        ))}
      </ol>
    </section>
  );
}
