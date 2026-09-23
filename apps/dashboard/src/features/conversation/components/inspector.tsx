import Link from 'next/link';
import { X } from 'lucide-react';
import type { ExecutionDetail, TimelineItem } from '../schemas/timeline.schema';
import { PayloadViewer } from './payload-viewer';
import { DecisionAnswers } from './decision-answers';
import { formatDuration } from '@/lib/utils/format-duration';
import { formatUsd } from '@/lib/utils/format-usd';
import { formatTokens } from '@/lib/utils/format-tokens';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule/60 py-1.5">
      <dt className="text-[0.8125rem] text-ink-muted">{label}</dt>
      <dd className="tabular text-right text-sm">{value}</dd>
    </div>
  );
}

function ItemDetail({ item }: { item: TimelineItem }) {
  if (item.kind === 'llm_call') {
    return (
      <>
        <dl>
          <Row label="Modelo" value={item.model} />
          <Row label="Duracao" value={formatDuration(item.durationMs)} />
          <Row label="Ate o primeiro token" value={formatDuration(item.ttftMs)} />
          <Row
            label="Tokens"
            value={`${formatTokens(item.inputTokens)} entrada · ${formatTokens(item.outputTokens)} saida`}
          />
          {item.cachedTokens ? (
            <Row label="Lidos do cache" value={formatTokens(item.cachedTokens)} />
          ) : null}
          <Row
            label="Custo"
            value={
              <>
                {formatUsd(item.costUsd)}
                <span className="ml-2 text-xs text-ink-muted">
                  {item.costStatus === 'confirmed'
                    ? 'cobrado'
                    : item.costStatus === 'pending'
                      ? 'aguardando'
                      : 'nao informado'}
                </span>
              </>
            }
          />
          <Row label="Fim" value={item.finishReason ?? '—'} />
          {item.generationId ? (
            <Row
              label="Geracao"
              value={<span className="font-mono text-xs">{item.generationId}</span>}
            />
          ) : null}
        </dl>
        <PayloadViewer label="Entrada" payload={item.request} />
        <PayloadViewer label="Saida" payload={item.response} />
      </>
    );
  }

  if (item.kind === 'tool_call') {
    return (
      <>
        <dl>
          <Row label="Ferramenta" value={item.name} />
          <Row label="Origem" value={item.origin} />
          <Row label="Duracao" value={formatDuration(item.durationMs)} />
          <Row label="Resultado" value={item.isError ? 'erro' : 'ok'} />
          {item.truncated ? <Row label="Truncado" value="sim" /> : null}
        </dl>
        <PayloadViewer label="Argumentos" payload={item.args} />
        <PayloadViewer label="Resultado" payload={item.result} />
      </>
    );
  }

  if (item.kind === 'mcp_call') {
    return (
      <>
        <dl>
          <Row label="Servidor" value={item.serverName} />
          <Row label="Ferramenta remota" value={item.remoteToolName} />
          <Row label="Duracao" value={formatDuration(item.durationMs)} />
          <Row
            label="Resultado"
            value={item.timedOut ? 'tempo esgotado' : item.isError ? 'erro' : 'ok'}
          />
        </dl>
        <PayloadViewer label="Entrada do MCP" payload={item.request} />
        <PayloadViewer label="Saida do MCP" payload={item.response} />
      </>
    );
  }

  return (
    <>
      <dl>
        <Row label="Ponto de decisao" value={item.point} />
        <Row label="Duracao" value={formatDuration(item.durationMs)} />
      </dl>
      <div className="mt-3">
        <DecisionAnswers answers={item.answers} />
      </div>
    </>
  );
}

interface Props {
  detail: ExecutionDetail;
  selectedId?: string;
  basePath: string;
}

/**
 * Painel do item selecionado.
 *
 * Sem selecao, mostra o que entrou na execucao — prompt, injections e schema
 * das ferramentas. Isso e constante entre as etapas, entao fica aqui e nao na
 * fita, onde competia com o que de fato muda.
 */
export function Inspector({ detail, selectedId, basePath }: Props) {
  const item = detail.items.find((candidate) => candidate.id === selectedId);

  return (
    <div className="sticky top-0 max-h-dvh overflow-y-auto px-5 py-4">
      <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-2">
        <h2 className="text-sm font-medium">{item ? 'Etapa selecionada' : 'O que entrou'}</h2>
        {item ? (
          <Link
            href={basePath}
            scroll={false}
            className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
          >
            <X className="size-3" aria-hidden />
            fechar
          </Link>
        ) : null}
      </div>

      <div className="mt-3">
        {item ? (
          <ItemDetail item={item} />
        ) : (
          <>
            <PayloadViewer label="System prompt" payload={detail.systemPrompt} />
            <PayloadViewer label="Schema das ferramentas" payload={detail.toolsSchema} />
            <p className="mt-4 text-[0.8125rem] text-ink-muted">
              Escolha uma etapa na fita para ver a entrada e a saida dela.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
