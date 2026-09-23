'use client';

import { useQuery } from '@tanstack/react-query';
import { useTelemetryBot } from '@/features/telemetry/telemetry-context';
import { payloadKeys } from './payload-keys';
import { fetchPayload } from './fetch-payload';

/**
 * `staleTime: Infinity` nao e chute: o id de um payload e o sha256 do proprio
 * conteudo, entao refazer a busca nunca poderia devolver algo diferente.
 */
export function usePayloadQuery(id: string, enabled: boolean) {
  const botId = useTelemetryBot();
  return useQuery({
    queryKey: payloadKeys.detail(id, botId),
    queryFn: () => fetchPayload(id, botId),
    enabled,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
}
