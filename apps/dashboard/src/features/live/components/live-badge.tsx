'use client';

import { useEffect, useState } from 'react';
import { useLiveTelemetry } from '../use-live-telemetry';
import { cn } from '@/lib/utils/cn';

const LABEL = {
  connecting: 'conectando',
  live: 'ao vivo',
  offline: 'sem conexao',
} as const;

/**
 * Diz se a tela esta acompanhando o agente em tempo real.
 *
 * Sem este aviso, uma tela parada e ambigua: nao da para distinguir "nada
 * aconteceu" de "parei de receber".
 */
export function LiveBadge() {
  const { status, updatedAt } = useLiveTelemetry();
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (updatedAt === null) return;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 1_200);
    return () => clearTimeout(timer);
  }, [updatedAt]);

  return (
    <span
      className="flex items-center gap-1.5 text-[11px] text-ink-muted"
      aria-live="polite"
      role="status"
    >
      <span
        aria-hidden
        className={cn(
          'inline-block size-1.5 rounded-full transition-shadow',
          status === 'live' && 'bg-ready',
          status === 'connecting' && 'animate-pulse bg-ink-disabled',
          status === 'offline' && 'bg-error',
          flash && 'ring-3 ring-ready/30',
        )}
      />
      {flash ? 'atualizado' : LABEL[status]}
    </span>
  );
}
