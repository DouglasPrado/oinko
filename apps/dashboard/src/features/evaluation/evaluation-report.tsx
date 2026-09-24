'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, TriangleAlert } from 'lucide-react';
import type { Aggregate, Comparison, EvaluationBatch, EvaluationCandidate, Opportunity } from '@oinko/agent-runtime/programming';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { inputStyle } from '@/features/projects/shared';
import { programmingRequest } from '@/features/programming/api';
import { formatDuration } from '@/lib/utils/format-duration';
import { formatUsd } from '@/lib/utils/format-usd';

interface Report {
  botId: string;
  candidates: (EvaluationCandidate & { comparison?: Comparison; provenImprovement: boolean })[];
  batches: (EvaluationBatch & { aggregate: Aggregate })[];
  opportunities: Opportunity[];
}

const RECOMMENDATION: Record<string, string> = {
  promote: 'recomenda promover',
  reject: 'reprovado',
  no_gain: 'sem ganho medido',
  insufficient_evidence: 'evidência insuficiente',
};
const STATUS: Record<string, string> = {
  draft: 'rascunho',
  evaluated: 'avaliado',
  approved: 'aprovado',
  rejected: 'reprovado',
  promoted: 'promovido',
  rolled_back: 'revertido',
};
const ENVIRONMENT: Record<string, string> = { simulated: 'simulado', docker: 'Docker', real: 'provedor real' };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-rule" aria-label={title}>
      <header className="flex h-11 items-center border-b border-rule px-4">
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      {children}
    </section>
  );
}

const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

/** Cost is shown with its coverage: unknown is never displayed as zero. */
function cost(aggregate: Aggregate) {
  if (aggregate.cost.perCompletedUsd === null) return aggregate.cost.coverage === 'none' ? 'custo desconhecido' : '—';
  return `${formatUsd(aggregate.cost.perCompletedUsd)}${aggregate.cost.lowerBound ? ' (mínimo; cobertura parcial)' : ''}`;
}

function Summary({ aggregate }: { aggregate: Aggregate }) {
  return (
    <p className="text-xs text-ink-muted">
      conclusão {percent(aggregate.completionRate)} · {aggregate.verdicts.passed} aprovadas, {aggregate.verdicts.failed} falhas,{' '}
      {aggregate.verdicts.infra_failure} de infraestrutura, {aggregate.verdicts.skipped} não executadas · tokens por concluída{' '}
      {aggregate.tokens.perCompleted === null ? '—' : Math.round(aggregate.tokens.perCompleted).toLocaleString('pt-BR')} · {cost(aggregate)}
      {aggregate.durationMs.median !== undefined && ` · mediana ${formatDuration(aggregate.durationMs.median)}`}
    </p>
  );
}

export function EvaluationReport({ botId }: { botId: string }) {
  const queryClient = useQueryClient();
  const key = ['evaluations', botId];
  const report = useQuery({
    queryKey: key,
    queryFn: async () => {
      const response = await fetch(`/api/evaluations?botId=${encodeURIComponent(botId)}`, { cache: 'no-store' });
      const value = (await response.json()) as Report & { error?: string };
      if (!response.ok) throw Object.assign(new Error(value.error ?? 'Falha ao carregar.'), { status: response.status });
      return value;
    },
  });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const act = useMutation({
    mutationFn: ({ candidateId, action }: { candidateId: string; action: string }) =>
      programmingRequest(`/api/evaluations/candidates/${encodeURIComponent(candidateId)}/${action}`, { note: notes[candidateId] ?? '' }),
    onSuccess: async (_value, { action }) => {
      toast.success({ approve: 'Aprovação registrada.', promote: 'Candidato promovido.', rollback: 'Configuração anterior restaurada.', observe: 'Observação registrada.' }[action] ?? 'Feito.');
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error) => toast.error('Operação recusada', error.message),
  });

  const [groupBy, setGroupBy] = useState<'policy' | 'project' | 'model'>('policy');
  const live = useQuery({
    queryKey: ['evaluations-live', botId, groupBy],
    queryFn: () => programmingRequest<{ rows: { key: string; runs: number; completed: number; completionRate: number | null; insufficientSample: boolean; tokens: number; costCoverage: string; runIds: string[] }[]; note: string }>(`/api/evaluations/live?botId=${encodeURIComponent(botId)}&groupBy=${groupBy}`),
  });
  if (report.isPending) return <Skeleton className="h-40 w-full" />;
  if (report.error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Não foi possível carregar as avaliações</AlertTitle>
        <AlertDescription>{report.error.message}</AlertDescription>
      </Alert>
    );
  const { candidates, batches, opportunities } = report.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-xs text-ink-muted">
          Avaliações rodam em raízes isoladas, sem publicação. Nenhum diagnóstico altera o bot: promover exige avaliação que recomende, aprovação registrada e a
          mesma revisão do bot; reverter lista os trabalhos afetados sem mudar seus snapshots.
        </p>
        <Button variant="outline" asChild>
          <a href={`/api/evaluations/export?botId=${encodeURIComponent(botId)}`}>
            <Download aria-hidden />
            Exportar (redigido)
          </a>
        </Button>
      </div>
      <Section title="Candidatos">
        <ul className="divide-y divide-rule">
          {candidates.map((candidate) => (
            <li key={candidate.id} className="space-y-2 px-4 py-3 text-[13px]" aria-label={`Candidato ${candidate.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{candidate.hypothesis}</span>
                <Badge variant="secondary">{candidate.kind}</Badge>
                <Badge variant={candidate.status === 'promoted' ? 'default' : 'outline'}>{STATUS[candidate.status] ?? candidate.status}</Badge>
              </div>
              {candidate.comparison ? (
                <div className="space-y-1 text-xs">
                  <p>
                    <span className={candidate.comparison.recommendation === 'promote' ? 'text-ready' : 'text-ink-muted'}>
                      {RECOMMENDATION[candidate.comparison.recommendation] ?? candidate.comparison.recommendation}
                    </span>
                    {' · '}
                    {candidate.comparison.reasons.join(' ')}
                  </p>
                  {candidate.comparison.tradeoffs.length > 0 && <p className="text-ink-muted">Trade-offs: {candidate.comparison.tradeoffs.join('; ')}</p>}
                  <p className="text-ink-muted">{candidate.comparison.causality}</p>
                </div>
              ) : (
                <p className="text-xs text-ink-muted">Sem avaliação: nenhuma melhoria comprovada.</p>
              )}
              {candidate.approval && (
                <p className="text-xs text-ink-muted">
                  Aprovado por {candidate.approval.by}: {candidate.approval.note}
                </p>
              )}
              {candidate.rollback && <p className="text-xs text-ink-muted">Revertido; {candidate.rollback.affectedRuns.length} trabalho(s) afetado(s) mantêm o próprio snapshot.</p>}
              {candidate.observations.map((observation) => (
                <p key={observation.at} className={observation.recommendation === 'rollback' ? 'flex items-center gap-1 text-xs text-error-ink' : 'text-xs text-ink-muted'}>
                  {observation.recommendation === 'rollback' && <TriangleAlert aria-hidden className="size-3.5" />}
                  Após promoção: conclusão {percent(observation.observed)} em {observation.sample} trabalho(s) (avaliado {percent(observation.expected)}) —{' '}
                  {observation.recommendation === 'rollback' ? 'regressão, recomenda reverter' : observation.recommendation === 'keep' ? 'manter' : 'amostra insuficiente'}
                </p>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                {candidate.status === 'evaluated' && (
                  <>
                    <input
                      aria-label="Motivo da aprovação"
                      className={inputStyle}
                      placeholder="Motivo da aprovação"
                      value={notes[candidate.id] ?? ''}
                      onChange={(event) => setNotes((current) => ({ ...current, [candidate.id]: event.target.value }))}
                    />
                    <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ candidateId: candidate.id, action: 'approve' })}>
                      Aprovar
                    </Button>
                  </>
                )}
                {candidate.status === 'approved' && (
                  <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ candidateId: candidate.id, action: 'promote' })}>
                    Promover
                  </Button>
                )}
                {candidate.status === 'promoted' && (
                  <>
                    <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ candidateId: candidate.id, action: 'observe' })}>
                      Observar
                    </Button>
                    <Button size="sm" variant="destructive" disabled={act.isPending} onClick={() => act.mutate({ candidateId: candidate.id, action: 'rollback' })}>
                      Reverter
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
          {!candidates.length && <li className="px-4 py-3 text-xs text-ink-muted">Nenhum candidato.</li>}
        </ul>
      </Section>
      <Section title="Lotes de avaliação">
        <ul className="divide-y divide-rule">
          {batches.map((batch) => (
            <li key={batch.id} className="space-y-1 px-4 py-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{batch.datasetVersion}</span>
                <Badge variant="outline">{batch.subject === 'baseline' ? 'baseline' : 'candidato'}</Badge>
                <Badge variant="secondary">{ENVIRONMENT[batch.environment] ?? batch.environment}</Badge>
                <span className="text-xs text-ink-muted">{batch.repetitions} repetição(ões) · política {batch.policyVersion}</span>
              </div>
              <Summary aggregate={batch.aggregate} />
              {batch.aggregate.sample.insufficient && <p className="text-xs text-warning-ink">Amostra insuficiente: {batch.aggregate.sample.reasons.join('; ')}.</p>}
            </li>
          ))}
          {!batches.length && <li className="px-4 py-3 text-xs text-ink-muted">Nenhum lote. Rode `pnpm --filter @oinko/bots evaluate --bot {botId} --dataset …`.</li>}
        </ul>
      </Section>
      <Section title="Trabalhos reais">
        <div className="space-y-2 px-4 py-3 text-[13px]">
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            Agrupar por
            <select aria-label="Agrupar por" className={inputStyle} value={groupBy} onChange={(event) => setGroupBy(event.target.value as typeof groupBy)}>
              <option value="policy">versão da política</option>
              <option value="project">projeto</option>
              <option value="model">modelo</option>
            </select>
          </label>
          {live.data?.note && <p className="text-xs text-ink-muted">{live.data.note}</p>}
          <ul className="divide-y divide-rule" aria-label="Grupos de trabalhos reais">
            {live.data?.rows.map((row) => (
              <li key={row.key} className="space-y-1 py-2">
                <p>
                  <span className="font-mono">{row.key}</span> · {row.completed}/{row.runs} concluídos ({percent(row.completionRate)}) · {row.tokens.toLocaleString('pt-BR')} tokens · custo{' '}
                  {row.costCoverage === 'complete' ? 'confirmado' : row.costCoverage === 'partial' ? 'parcial' : 'desconhecido'}
                  {row.insufficientSample && <span className="text-warning-ink"> · amostra insuficiente</span>}
                </p>
                <p className="flex flex-wrap gap-2 text-xs">
                  {row.runIds.slice(0, 12).map((runId) => (
                    <Link key={runId} className="font-mono text-info-ink hover:underline" href={`/bots/${encodeURIComponent(botId)}/trabalhos/${encodeURIComponent(runId)}`}>
                      #{runId.slice(4, 12)}
                    </Link>
                  ))}
                </p>
              </li>
            ))}
            {live.data && !live.data.rows.length && <li className="py-2 text-xs text-ink-muted">Nenhum trabalho encerrado ainda.</li>}
          </ul>
        </div>
      </Section>
      {opportunities.length > 0 && (
        <Section title="Oportunidades">
          <ul className="divide-y divide-rule">
            {opportunities.map((opportunity) => (
              <li key={opportunity.category} className="space-y-1 px-4 py-3 text-[13px]">
                <p>
                  <span className="font-medium">{opportunity.category}</span> · confiança {opportunity.confidence === 'low' ? 'baixa' : 'média'} · casos{' '}
                  {opportunity.affectedCases.join(', ')}
                </p>
                <p className="text-xs text-ink-muted">Hipótese (proposta, não aplicada): {opportunity.hypothesis}</p>
                {opportunity.evidence.length > 0 && <p className="font-mono text-[11px] text-ink-muted">evidência: {opportunity.evidence.slice(0, 6).join(', ')}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
