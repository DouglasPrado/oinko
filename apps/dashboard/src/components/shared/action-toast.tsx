'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/toast';

/**
 * Aviso de uma acao que terminou fora da pagina, como o retorno de um OAuth.
 *
 * Dispara uma vez e tira o parametro da URL: recarregar a pagina nao pode
 * anunciar de novo uma autorizacao que ja aconteceu.
 */
export function ActionToast({
  tone,
  title,
  description,
  clearParam,
}: {
  tone: 'success' | 'error' | 'info';
  title: string;
  description?: string;
  clearParam?: string;
}) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    toast[tone](title, description);
    if (!clearParam) return;
    const url = new URL(window.location.href);
    url.searchParams.delete(clearParam);
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [clearParam, description, router, title, tone]);

  return null;
}
