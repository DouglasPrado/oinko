'use client';

import { useState } from 'react';
import { useTelemetryBot } from '@/features/telemetry/telemetry-context';
import { telemetryHref } from '@/features/telemetry/telemetry-href';
import { Download, Loader2 } from 'lucide-react';
import type { PayloadRef } from '../schemas/timeline.schema';
import { usePayloadQuery } from '../api/use-payload-query';
import { PayloadBody } from './payload-body';
import { formatBytes } from '@/lib/utils/format-bytes';

/**
 * Mostra o inicio do conteudo e so busca o corpo quando alguem pede.
 *
 * A listagem ja traz o preview e o tamanho; um prompt de 184 KB por chamada
 * derrubaria a pagina se viesse junto. O corpo completo chega pelo route
 * handler, que e o caso canonico de BFF aqui.
 */
export function PayloadViewer({ label, payload }: { label: string; payload: PayloadRef | null }) {
  const botId = useTelemetryBot();
  const [wanted, setWanted] = useState(false);
  const query = usePayloadQuery(payload?.id ?? '', wanted && payload !== null);

  // Payload ausente ou vazio nao rende uma caixa vazia: uma chamada que so
  // pediu uma tool nao tem texto de saida, e desenhar um retangulo em branco
  // para isso e ruido.
  if (!payload || payload.sizeBytes === 0) return null;

  // O preview cobre 2 KB. Quando o conteudo inteiro cabe nele, nao ha nada a
  // buscar, e oferecer "ver completo" para o que ja esta na tela e ruido.
  const complete = payload.preview.length >= payload.sizeBytes;
  const body = query.data ?? null;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[0.8125rem] font-medium">{label}</span>
        <span className="tabular text-xs text-ink-muted">{formatBytes(payload.sizeBytes)}</span>
        {!payload.redacted ? (
          <span className="text-xs text-fault">conteudo nao redigido</span>
        ) : null}
        {body === null && !complete ? (
          <button
            type="button"
            onClick={() => setWanted(true)}
            disabled={query.isFetching}
            className="inline-flex items-center gap-1.5 border border-rule bg-surface px-2 py-1 text-xs hover:bg-paper disabled:opacity-60"
            style={{ borderRadius: 'var(--radius-control)' }}
          >
            {query.isFetching ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
            {query.isFetching ? 'Carregando' : 'Ver completo'}
          </button>
        ) : complete ? null : (
          <a
            href={telemetryHref(
              `/api/payloads/${encodeURIComponent(payload.id)}?download=1`,
              botId,
            )}
            className="inline-flex items-center gap-1.5 text-xs text-time underline"
          >
            <Download className="size-3" aria-hidden />
            Baixar
          </a>
        )}
      </div>

      {query.error ? (
        <p role="alert" className="mt-2 text-xs text-fault">
          {query.error.message}
        </p>
      ) : null}

      <PayloadBody text={body ?? payload.preview} truncated={body === null && !complete} />
    </div>
  );
}
