'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 448;
const STORAGE_KEY = 'oinko:inspector-width';
/** Passo do ajuste por teclado. */
const STEP = 32;

/** Barra lateral de conversas, que nao encolhe. */
const RAIL_WIDTH = 288;
/** Espaco que a fita precisa para continuar legivel. */
const TAPE_MIN_WIDTH = 420;

function clamp(width: number): number {
  if (typeof window === 'undefined') return Math.max(width, MIN_WIDTH);

  // O teto sai do que sobra, nao de uma fracao da janela: o inspetor nao pode
  // espremer a fita ate sumir, que e o que acontecia com 70% da largura.
  const max = window.innerWidth - RAIL_WIDTH - TAPE_MIN_WIDTH;
  return Math.min(Math.max(width, MIN_WIDTH), Math.max(max, MIN_WIDTH));
}

function stored(): number {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === null ? DEFAULT_WIDTH : clamp(Number(saved));
  } catch {
    // Janela anonima, storage bloqueado: a largura padrao serve.
    return DEFAULT_WIDTH;
  }
}

/**
 * Inspetor com largura ajustavel pela borda.
 *
 * Um payload de prompt e largo por natureza, e qual largura serve depende do
 * que se esta lendo — uma arvore de JSON pede mais espaco que uma lista de
 * metricas. A medida fica em localStorage porque e preferencia de quem olha,
 * nao estado do sistema: nao pertence a URL nem ao servidor.
 */
export function InspectorPanel({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const panel = useRef<HTMLElement>(null);

  // Lido depois da montagem: o servidor nao conhece o localStorage, e usar o
  // valor salvo na primeira renderizacao daria divergencia de hidratacao.
  useEffect(() => {
    setWidth(stored());
  }, []);

  const persist = useCallback((next: number) => {
    setWidth(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Sem storage, a largura vale so para esta sessao.
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (event: PointerEvent): void => {
      const right = panel.current?.getBoundingClientRect().right ?? window.innerWidth;
      setWidth(clamp(right - event.clientX));
    };
    const onUp = (): void => {
      setDragging(false);
      setWidth((current) => {
        try {
          window.localStorage.setItem(STORAGE_KEY, String(current));
        } catch {
          // idem
        }
        return current;
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // Sem isto, arrastar sobre o texto seleciona a pagina inteira.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [dragging]);

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      persist(clamp(width + STEP));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      persist(clamp(width - STEP));
    } else if (event.key === 'Home') {
      event.preventDefault();
      persist(DEFAULT_WIDTH);
    }
  }

  return (
    <aside
      ref={panel}
      aria-label="Detalhe"
      className="inspector-panel relative w-full shrink-0 border-t border-rule bg-canvas lg:border-t-0 lg:border-l"
      style={{ ['--inspector-width' as string]: `${width}px` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Largura do painel"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onKeyDown={onKeyDown}
        className="absolute top-0 left-0 hidden h-full w-1.5 -translate-x-1/2 cursor-col-resize bg-transparent transition-colors outline-none hover:bg-focus/30 focus-visible:bg-focus/60 lg:block"
      />
      {children}
    </aside>
  );
}
