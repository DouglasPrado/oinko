'use client';

import { useEffect, useState } from 'react';
import { useTelemetryBot } from '@/features/telemetry/telemetry-context';
import { telemetryHref } from '@/features/telemetry/telemetry-href';
import { useRouter } from 'next/navigation';

export type LiveStatus = 'connecting' | 'live' | 'offline';

/**
 * Refaz a tela quando chega telemetria nova.
 *
 * `router.refresh()` re-executa os Server Components e troca o conteudo sem
 * recarregar a pagina: a rolagem, a etapa selecionada e a largura do inspetor
 * ficam onde estavam. Sem isso, so restaria recarregar — e perder o lugar toda
 * vez que o agente respondesse.
 */
export function useLiveTelemetry(): { status: LiveStatus; updatedAt: number | null } {
  const router = useRouter();
  const botId = useTelemetryBot();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    const source = new EventSource(telemetryHref('/api/stream', botId));

    const onOpen = (): void => setStatus('live');
    const onChanged = (): void => {
      setUpdatedAt(Date.now());
      router.refresh();
    };
    // O EventSource reconecta sozinho; o estado so reflete o que esta havendo.
    const onError = (): void => setStatus('offline');

    source.addEventListener('open', onOpen);
    source.addEventListener('changed', onChanged);
    source.addEventListener('error', onError);

    return () => {
      source.removeEventListener('open', onOpen);
      source.removeEventListener('changed', onChanged);
      source.removeEventListener('error', onError);
      source.close();
    };
  }, [router, botId]);

  return { status, updatedAt };
}
