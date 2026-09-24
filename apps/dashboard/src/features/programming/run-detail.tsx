'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Circle, Clock, Coins, FileText, Pause, Play, Square, TriangleAlert, Zap } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { PageHeader } from '@/components/shared/page-header';
import { Metric, MetricGrid } from '@/features/projects/workspace-ui';
import { textareaStyle } from '@/features/projects/shared';
import { formatUsd } from '@/lib/utils/format-usd';
import { formatDuration } from '@/lib/utils/format-duration';
import { cn } from '@/lib/utils/cn';
import { RunStatus } from './run-list';
import {
  ARTIFACT_LABEL,
  CI_LABEL,
  CRITERION_LABEL,
  DELIVERY_LABEL,
  ciState,
  programmingRequest,
  shortRunId,
  type RunDetail as Detail,
  type TimelineEntry,
} from './api';

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className="rounded-xl border border-rule" aria-label={title}>
      <header className="flex h-11 items-center border-b border-rule px-4">
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      <div className={className ?? 'p-4'}>{children}</div>
    </section>
  );
}

const LEVELS: [Extract<keyof Detail['levels'], string>, string][] = [
  ['planned', 'Planejado'],
  ['executed', 'Executado'],
  ['tested', 'Testado na revisão atual'],
  ['publishedDraft', 'Publicado em draft PR'],
  ['acceptedByUser', 'Aceito pelo usuário'],
];

const CATEGORIES: Record<string, string[]> = {
  Estado: ['run_', 'checkpoint_saved', 'step_created', 'cycle_', 'progress_assessed', 'recovery_'],
  Operações: ['operation_', 'permission_', 'workspace_', 'check_', 'git_', 'project_'],
  Controle: ['control_requested', 'user_direction_received', 'plan_revised', 'acceptance_evaluated', 'decision_recorded'],
  Uso: ['usage_', 'run_metrics_updated'],
};

function eventLine(entry: TimelineEntry): string {
  const payload = entry.event.payload ?? {};
  const bits = ['kind', 'from', 'to', 'result', 'code', 'reason', 'verdict', 'outcome']
    .map((key) => payload[key])
    .filter((value) => typeof value === 'string' || typeof value === 'number');
  return bits.join(' · ');
}

export function RunDetailView({ botId, runId }: { botId: string; runId: string }) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['run', runId],
    queryFn: () => programmingRequest<Detail>(`/api/runs/${encodeURIComponent(runId)}?botId=${encodeURIComponent(botId)}`),
    refetchInterval: 2000,
    retry: (count, error) => (error as { status?: number }).status !== 404 && count < 2,
  });
  const [events, setEvents] = useState<TimelineEntry[]>([]);
  const [category, setCategory] = useState<string>('Todos');
  const lastId = events.at(-1)?.id;
  const timeline = useQuery({
    queryKey: ['timeline', runId, lastId ?? 0],
    queryFn: () =>
      programmingRequest<{ entries: TimelineEntry[]; nextAfterId?: number }>(
        `/api/runs/${encodeURIComponent(runId)}/timeline?limit=200${lastId !== undefined ? `&afterId=${lastId}` : ''}`,
      ),
    refetchInterval: 2000,
    enabled: detail.isSuccess,
  });
  useEffect(() => {
    // Append only new entries: pages never duplicate while events keep arriving.
    const entries = timeline.data?.entries;
    if (entries?.length)
      setEvents((current) => {
        const known = new Set(current.map((entry) => entry.id));
        return [...current, ...entries.filter((entry) => !known.has(entry.id))];
      });
  }, [timeline.data]);
  const shown = useMemo(
    () =>
      category === 'Todos'
        ? events
        : events.filter((entry) => CATEGORIES[category]!.some((prefix) => entry.event.type.startsWith(prefix))),
    [events, category],
  );
  const [direction, setDirection] = useState('');
  const [note, setNote] = useState('');
  const control = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: Record<string, unknown> }) =>
      programmingRequest<{ status: string; message: string; pendingReconciliation: string[] }>(
        `/api/runs/${encodeURIComponent(runId)}/${action}`,
        body ?? {},
      ),
    onSuccess: async (result) => {
      if (result.status === 'rejected') toast.error('Pedido recusado', result.message);
      else toast.success(result.message);
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
    },
    onError: (error) => toast.error('Não foi possível enviar o pedido', error.message),
  });

  if (detail.isPending)
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (detail.error)
    return (
      <Alert variant="destructive">
        <AlertTitle>{(detail.error as { status?: number }).status === 404 ? 'Trabalho não encontrado' : 'Não foi possível carregar o trabalho'}</AlertTitle>
        <AlertDescription>{detail.error.message}</AlertDescription>
      </Alert>
    );
  const { run, plan, criteria, operations, uncertain, artifacts, publications, levels, metrics, telemetry, steps } = detail.data;
  const current = plan.at(-1);
  const live = ['queued', 'running', 'paused', 'blocked'].includes(run.state);
  const submitDirection = (event: FormEvent) => {
    event.preventDefault();
    if (!direction.trim()) return;
    control.mutate({ action: 'steer', body: { text: direction.trim() } });
    setDirection('');
  };
  const traces = steps.flatMap((step) => step.traceIds.map((traceId) => ({ step, traceId })));
  const thread = encodeURIComponent(`programming:${run.id}`);
  return (
    <div className="space-y-5">
      <PageHeader
        trail={[
          { label: 'Bots', href: '/bots' },
          { label: run.botId, href: `/bots/${encodeURIComponent(run.botId)}` },
          { label: 'Trabalhos', href: `/bots/${encodeURIComponent(run.botId)}/trabalhos` },
          { label: `#${shortRunId(run.id)}` },
        ]}
        title={<span title={run.request}>{run.request}</span>}
        badges={
          <>
            <RunStatus run={run} />
            {run.mode === 'analysis' && <Badge variant="secondary">somente análise</Badge>}
          </>
        }
        actions={
          live && (
            <>
              {run.state === 'running' || run.state === 'queued' ? (
                <Button variant="outline" disabled={control.isPending} onClick={() => control.mutate({ action: 'pause' })}>
                  <Pause aria-hidden />
                  Pausar
                </Button>
              ) : run.state === 'paused' ? (
                <Button variant="outline" disabled={control.isPending} onClick={() => control.mutate({ action: 'resume' })}>
                  <Play aria-hidden />
                  Retomar
                </Button>
              ) : null}
              <Button variant="destructive" disabled={control.isPending} onClick={() => control.mutate({ action: 'cancel' })}>
                <Square aria-hidden />
                Cancelar
              </Button>
            </>
          )
        }
      />
      <p className="text-xs text-ink-muted">
        Projeto <span className="font-mono">{run.projectId}</span>
        {run.taskId && (
          <>
            {' '}· tarefa <span className="font-mono">{run.taskId}</span>
          </>
        )}{' '}
        · política <span className="font-mono">{run.policyVersion.slice(7, 19)}</span> · revisão do plano {run.planRevision}
      </p>
      {run.blocked && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>Bloqueado: {run.blocked.code}</AlertTitle>
          <AlertDescription>
            <p>{run.blocked.message}</p>
            {run.blocked.needs && <p className="mt-1">{run.blocked.needs}</p>}
            {run.blocked.operationId && <p className="mt-1 font-mono text-xs">operação {run.blocked.operationId}</p>}
            <form
              className="mt-3 flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                control.mutate({ action: 'resume', body: { note } });
              }}
            >
              <input
                aria-label="Como o bloqueio foi resolvido"
                className="h-9 flex-1 rounded-md border border-rule-strong bg-canvas px-3 text-sm text-ink"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Como o bloqueio foi resolvido"
              />
              <Button type="submit" variant="outline" disabled={!note.trim() || control.isPending}>
                Retomar
              </Button>
            </form>
          </AlertDescription>
        </Alert>
      )}
      {uncertain.length > 0 && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>Operações com resultado incerto</AlertTitle>
          <AlertDescription className="text-ink!">
            {uncertain.length} operação(ões) ainda exigem reconciliação. Parar não desfaz efeitos.
          </AlertDescription>
        </Alert>
      )}
      {run.finalOutcome && (
        <Alert variant={run.finalOutcome.outcome === 'completed' ? 'default' : 'warning'}>
          <AlertTitle>{run.finalOutcome.delivery ? DELIVERY_LABEL[run.finalOutcome.delivery] : run.finalOutcome.outcome}</AlertTitle>
          <AlertDescription className="text-ink! whitespace-pre-wrap">{run.finalOutcome.summary}</AlertDescription>
        </Alert>
      )}
      <MetricGrid>
        <Metric label="Ciclos" value={run.cycleCount} icon={<Zap aria-hidden />} hint={`${run.noProgressCount} sem progresso seguidos`} />
        <Metric label="Tokens" value={metrics.tokens.total.toLocaleString('pt-BR')} icon={<FileText aria-hidden />} hint={Object.entries(metrics.tokens.byRole).map(([role, value]) => `${role} ${value}`).join(' · ') || 'sem chamadas'} />
        <Metric
          label="Custo confirmado"
          value={formatUsd(metrics.cost.totalUsd ?? (metrics.calls ? metrics.cost.confirmedUsd : null))}
          icon={<Coins aria-hidden />}
          hint={`cobertura ${Math.round(metrics.cost.coverage * 100)}% · ${metrics.cost.pendingCalls} pendente(s) · ${metrics.cost.unavailableCalls} indisponível(is)`}
        />
        <Metric label="Duração" value={formatDuration(metrics.durations.total)} icon={<Clock aria-hidden />} hint={`fila ${formatDuration(metrics.durations.queue)}`} />
      </MetricGrid>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-5">
          <Section title="Objetivo e plano">
            <p className="text-sm whitespace-pre-wrap text-ink">{current?.objective}</p>
            {current && current.plan.length > 0 && (
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink">
                {current.plan.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            )}
            {plan.length > 1 && (
              <p className="mt-3 text-xs text-ink-muted">
                {plan.length} revisões · última: {current?.reason} ({current?.source})
              </p>
            )}
            {live && (
              <form onSubmit={submitDirection} className="mt-4 space-y-2" aria-label="Orientar trabalho">
                <textarea
                  aria-label="Orientação"
                  className={cn(textareaStyle, 'min-h-20')}
                  value={direction}
                  onChange={(event) => setDirection(event.target.value)}
                  placeholder="Corrija o escopo ou dê uma orientação; aplicada no próximo ponto seguro."
                />
                <Button type="submit" variant="outline" disabled={!direction.trim() || control.isPending}>
                  Enviar orientação
                </Button>
              </form>
            )}
          </Section>
          <Section title="Linha do tempo" className="p-0">
            <div role="tablist" aria-label="Filtro da linha do tempo" className="flex flex-wrap gap-1 border-b border-rule p-2">
              {['Todos', ...Object.keys(CATEGORIES)].map((name) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={category === name}
                  onClick={() => setCategory(name)}
                  className={cn('h-8 rounded-md px-2.5 text-xs', category === name ? 'bg-selected font-medium' : 'text-ink-muted hover:bg-hover')}
                >
                  {name}
                </button>
              ))}
            </div>
            <ol className="max-h-[32rem] divide-y divide-rule overflow-y-auto" aria-label="Eventos">
              {shown.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 px-4 py-2 text-xs">
                  <span className="w-16 shrink-0 font-mono text-ink-muted tabular-nums">
                    {new Date(entry.event.occurredAt).toLocaleTimeString('pt-BR')}
                  </span>
                  <span className={cn('font-mono', entry.event.status === 'failed' || entry.event.status === 'denied' ? 'text-error-ink' : entry.event.status === 'uncertain' ? 'text-warning-ink' : 'text-ink')}>
                    {entry.event.type}
                  </span>
                  <span className="min-w-0 truncate text-ink-muted">{eventLine(entry)}</span>
                </li>
              ))}
              {!shown.length && <li className="px-4 py-3 text-xs text-ink-muted">Sem eventos nesta categoria.</li>}
            </ol>
            {telemetry.gaps.length > 0 && (
              <p className="border-t border-rule px-4 py-2 text-xs text-warning-ink">
                Lacunas na sequência de eventos: {telemetry.gaps.map((gap) => `${gap.producer} (${gap.missing})`).join(', ')}
              </p>
            )}
          </Section>
          <Section title="Operações" className="p-0">
            <ul className="divide-y divide-rule" aria-label="Operações">
              {operations.map((operation) => (
                <li key={operation.operationId} className={cn('flex items-center justify-between gap-3 px-4 py-2 text-xs', operation.state === 'uncertain' && 'bg-warning-bg')}>
                  <span className="font-mono">{operation.kind}</span>
                  <span className="text-ink-muted">
                    {operation.state}
                    {operation.attempt > 1 ? ` · tentativa ${operation.attempt}` : ''}
                    {operation.error ? ` · ${operation.error.code}` : ''}
                  </span>
                </li>
              ))}
              {!operations.length && <li className="px-4 py-3 text-xs text-ink-muted">Nenhuma operação com efeito.</li>}
            </ul>
          </Section>
        </div>
        <div className="space-y-5">
          <Section title="Entrega" className="p-0">
            <ul className="divide-y divide-rule">
              {LEVELS.map(([key, label]) => (
                <li key={key} className="flex items-center gap-2 px-4 py-2 text-[13px]">
                  {levels[key] ? <Check aria-hidden className="size-4 text-ready" /> : <Circle aria-hidden className="size-4 text-ink-disabled" />}
                  <span className={levels[key] ? 'text-ink' : 'text-ink-muted'}>{label}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Critérios" className="p-0">
            <ul className="divide-y divide-rule" aria-label="Critérios">
              {criteria.map((criterion) => (
                <li key={criterion.id} className="px-4 py-2 text-[13px]">
                  <span className="text-ink">{criterion.description}</span>
                  <span className={cn('ml-2 text-xs', criterion.status === 'satisfied' ? 'text-ready' : criterion.status === 'failed' || criterion.status === 'invalidated' ? 'text-error-ink' : 'text-ink-muted')}>
                    {CRITERION_LABEL[criterion.status] ?? criterion.status}
                  </span>
                  {criterion.revision && (
                    <span className="ml-2 font-mono text-[11px] text-ink-muted" title={criterion.revision}>
                      rev {criterion.revision.replace(/^tree:/, '').slice(0, 8)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Evidências" className="p-0">
            <ul className="divide-y divide-rule" aria-label="Evidências">
              {artifacts.map((artifact) => (
                <li key={artifact.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                  {artifact.expiredAt ? (
                    <span className="text-ink-muted">{artifact.type} · expirado</span>
                  ) : artifact.capturePolicy !== 'full' ? (
                    <span className="text-ink-muted">{artifact.type} · conteúdo não capturado ({artifact.capturePolicy})</span>
                  ) : (
                    <a className="text-info-ink underline-offset-4 hover:underline" href={`/api/artifacts/${encodeURIComponent(artifact.id)}`} target="_blank" rel="noreferrer">
                      {ARTIFACT_LABEL[artifact.type] ?? artifact.type}
                    </a>
                  )}
                  <span className="text-ink-muted tabular-nums">{artifact.size.toLocaleString('pt-BR')} B</span>
                </li>
              ))}
              {!artifacts.length && <li className="px-4 py-3 text-xs text-ink-muted">Sem evidências ainda.</li>}
            </ul>
          </Section>
          {publications.length > 0 && (
            <Section title="Publicação" className="p-0">
              <ul className="divide-y divide-rule">
                {publications.map((publication) => (
                  <li key={publication.id} className="px-4 py-2 text-xs">
                    {publication.prUrl ? (
                      <a className="text-info-ink hover:underline" href={publication.prUrl} target="_blank" rel="noreferrer">
                        {publication.repositoryId} · draft #{publication.prNumber}
                      </a>
                    ) : (
                      <span>{publication.repositoryId} · {publication.branch}</span>
                    )}
                    <span className={cn('ml-2', ciState(publication.checkRefs) === 'passed' ? 'text-ready' : 'text-ink-muted')}>
                      {CI_LABEL[ciState(publication.checkRefs)] ?? ciState(publication.checkRefs)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {traces.length > 0 && (
            <Section title="Chamadas do modelo" className="p-0">
              <ul className="divide-y divide-rule">
                {traces.map(({ traceId }) => (
                  <li key={traceId} className="px-4 py-2 text-xs">
                    <Link className="font-mono text-info-ink hover:underline" href={`/bots/${encodeURIComponent(botId)}/telemetria/threads/${thread}/${encodeURIComponent(traceId)}`}>
                      {traceId.slice(0, 8)}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
