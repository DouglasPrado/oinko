import type { RunDetail, RunSummary, TimelineEntry } from '@oinko/agent-runtime/programming';

export type { RunDetail, RunSummary, TimelineEntry };

export async function programmingRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...(body !== undefined && {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  const value = (await response.json()) as { error?: string; code?: string };
  if (!response.ok) throw Object.assign(new Error(value.error ?? 'Não foi possível concluir a operação.'), { code: value.code, status: response.status });
  return value as T;
}

export const RUN_STATE_LABEL: Record<string, string> = {
  queued: 'Na fila',
  running: 'Em execução',
  paused: 'Pausado',
  blocked: 'Bloqueado',
  completed: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

export const CRITERION_LABEL: Record<string, string> = {
  pending: 'pendente',
  satisfied: 'atendido',
  failed: 'falhou',
  invalidated: 'invalidado',
};

export const ARTIFACT_LABEL: Record<string, string> = {
  screenshot: 'captura de tela',
  report: 'relatório',
};

/** CI of the published commit; anything but a pass is never "validated". */
export const CI_LABEL: Record<string, string> = {
  passed: 'CI aprovado',
  failed: 'CI reprovado',
  cancelled: 'CI cancelado',
  queued: 'CI na fila · não validado integralmente',
  running: 'CI em andamento · não validado integralmente',
  unknown: 'sem resultado de CI · não validado integralmente',
  unavailable: 'CI indisponível · não validado integralmente',
  superseded: 'CI de commit anterior',
};

export function ciState(checkRefs: readonly string[]): string {
  return checkRefs.at(-1)?.split(':').at(-1) ?? 'unknown';
}

export const DELIVERY_LABEL: Record<string, string> = {
  technical: 'Concluído tecnicamente',
  draft_pr: 'Entregue em draft PR',
  accepted: 'Aceito pelo usuário',
};

/** A requested pause/cancel is shown as a request until the executor applies it. */
export function stateText(run: Pick<RunSummary, 'state' | 'pendingControls'>): string {
  const base = RUN_STATE_LABEL[run.state] ?? run.state;
  const pending = run.pendingControls.filter((kind) => kind !== 'steer');
  if (!pending.length) return base;
  const label = pending.includes('cancel') ? 'cancelamento solicitado' : 'pausa solicitada';
  return `${base} · ${label}`;
}

export function runHref(botId: string, runId: string) {
  return `/bots/${encodeURIComponent(botId)}/trabalhos/${encodeURIComponent(runId)}`;
}

export const shortRunId = (runId: string) => runId.slice(4, 12);
