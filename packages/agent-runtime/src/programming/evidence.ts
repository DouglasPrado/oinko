import { AsyncLocalStorage } from 'node:async_hooks';
import type { Actor, Criterion, ProgrammingRun } from './contracts.js';
import { ProgrammingError } from './errors.js';
import type { OperationRecorder, OperationSpec, OperationOutcome, OperationContext } from './operations.js';

/**
 * Observable facts produced during a cycle. Progress is defined only by
 * these — never by what the model says about its own work.
 */
export type Evidence =
  | { kind: 'edit'; repositoryId: string; paths: string[]; revision: string; operationId?: string }
  | { kind: 'information'; source: string; fingerprint: string }
  | {
      kind: 'check';
      checkKind: string;
      repositoryId: string;
      result: 'passed' | 'failed' | 'skipped' | 'timeout' | 'infrastructure';
      revision: string;
      /** Revision observed when the check ended; differs if files changed meanwhile. */
      revisionAfter?: string;
      fingerprint: string;
      artifactId?: string;
    }
  | { kind: 'functional'; criterionId?: string; result: 'passed' | 'failed'; revision: string; fingerprint: string; artifactId?: string }
  | { kind: 'publication'; repositoryId: string; sha: string; prNumber?: number; ci?: string; fingerprint: string }
  | { kind: 'report'; artifactId?: string; fingerprint: string }
  | { kind: 'error'; fingerprint: string; message: string };

export function evidenceFingerprint(item: Evidence): string {
  switch (item.kind) {
    case 'edit':
      return `edit:${item.repositoryId}:${item.revision}`;
    case 'error':
      return `error:${item.fingerprint}`;
    default:
      return `${item.kind}:${item.fingerprint}`;
  }
}

/** Where a cycle's tools report what they observed and ask for safe points. */
export interface RunContext {
  run: ProgrammingRun;
  stepId: string;
  actor: Actor;
  signal: AbortSignal;
  evidence: Evidence[];
  /** Latest known revision per repository (tree hash or commit). */
  revisions: Map<string, string>;
  record(item: Evidence): void;
  /**
   * Throws when a pause or cancel was requested: tools call it before an
   * operation with effects, so the run stops between effects, not inside one.
   */
  safePoint(): void;
  operation<T>(spec: OperationSpec, effect: (context: OperationContext) => Promise<T>): Promise<OperationOutcome<T>>;
}

export class SafePointInterrupt extends Error {
  constructor(readonly reason: 'pause' | 'cancel' | 'direction') {
    super(`Interrompido no ponto seguro (${reason}).`);
    this.name = 'SafePointInterrupt';
  }
}

const storage = new AsyncLocalStorage<RunContext>();

export function withRunContext<T>(context: RunContext, action: () => Promise<T>): Promise<T> {
  return storage.run(context, action);
}

export function currentRunContext(): RunContext | undefined {
  return storage.getStore();
}

export function requireRunContext(): RunContext {
  const context = storage.getStore();
  if (!context)
    throw new ProgrammingError('invalid_request', 'Esta ferramenta só funciona dentro de um run de programação.');
  return context;
}

export interface RunContextOptions {
  run: ProgrammingRun;
  stepId: string;
  actor: Actor;
  signal: AbortSignal;
  recorder: OperationRecorder;
  revisions: Map<string, string>;
  interrupt: () => SafePointInterrupt['reason'] | undefined;
  onOperation?: (delta: 1 | -1) => void;
}

export function createRunContext(options: RunContextOptions): RunContext {
  const evidence: Evidence[] = [];
  const context: RunContext = {
    run: options.run,
    stepId: options.stepId,
    actor: options.actor,
    signal: options.signal,
    evidence,
    revisions: options.revisions,
    record(item) {
      evidence.push(item);
      if (item.kind === 'edit') options.revisions.set(item.repositoryId, item.revision);
      else if (item.kind === 'check') options.revisions.set(item.repositoryId, item.revisionAfter ?? item.revision);
    },
    safePoint() {
      const reason = options.interrupt();
      if (reason && reason !== 'direction') throw new SafePointInterrupt(reason);
      options.signal.throwIfAborted();
    },
    async operation(spec, effect) {
      if (spec.class !== 'read') context.safePoint();
      options.onOperation?.(1);
      try {
        return await options.recorder.run(options.run, options.actor, { ...spec, stepId: options.stepId }, effect);
      } finally {
        options.onOperation?.(-1);
      }
    },
  };
  return context;
}

export interface ProgressVerdict {
  progressed: boolean;
  newFacts: string[];
  repeatedErrors: string[];
  reason: string;
}

/**
 * Progress = a verifiable new fact: new relevant information, a valid edit
 * that changed the revision, or a check/functional result not seen before.
 * Errors and repetitions of known facts never count.
 */
export function assessProgress(cycle: readonly Evidence[], seen: ReadonlySet<string>): ProgressVerdict {
  const newFacts: string[] = [];
  const repeatedErrors: string[] = [];
  for (const item of cycle) {
    const fingerprint = evidenceFingerprint(item);
    if (item.kind === 'error') {
      if (seen.has(fingerprint)) repeatedErrors.push(fingerprint);
      continue;
    }
    if (item.kind === 'check' && item.result === 'infrastructure') continue;
    if (!seen.has(fingerprint) && !newFacts.includes(fingerprint)) newFacts.push(fingerprint);
  }
  return {
    progressed: newFacts.length > 0,
    newFacts,
    repeatedErrors,
    reason: newFacts.length
      ? `Nova evidência: ${newFacts.slice(0, 3).join(', ')}`
      : repeatedErrors.length
        ? 'Os mesmos erros se repetiram sem nova evidência.'
        : 'Nenhuma evidência verificável nova neste ciclo.',
  };
}

export interface CriteriaEvaluation {
  criteria: Criterion[];
  invalidated: { id: string; reason: string; revision: string }[];
  satisfied: number;
}

const CHECK_KINDS_FOR_DEFAULT = new Set(['test', 'lint', 'build', 'typecheck']);

/**
 * Re-evaluates criteria against all evidence for the *current* revision.
 * A new edit changes the revision and invalidates checks that passed before.
 */
export function evaluateCriteria(
  criteria: readonly Criterion[],
  evidence: readonly Evidence[],
  revisions: ReadonlyMap<string, string>,
  options: { completionProposed?: boolean } = {},
): CriteriaEvaluation {
  const current = (repositoryId: string) => revisions.get(repositoryId);
  const invalidated: CriteriaEvaluation['invalidated'] = [];
  const next = criteria.map((criterion): Criterion => {
    const previous = criterion.status;
    let status: Criterion['status'] = previous === 'failed' ? 'pending' : previous;
    let refs = criterion.evidenceRefs;
    let revision = criterion.revision;
    const edits = evidence.filter((item): item is Extract<Evidence, { kind: 'edit' }> => item.kind === 'edit');
    switch (criterion.kind) {
      case 'diff': {
        const edited = edits.filter((item) => current(item.repositoryId) === item.revision);
        status = edited.length ? 'satisfied' : 'pending';
        refs = edited.map((item) => item.operationId ?? evidenceFingerprint(item));
        revision = edited.at(-1)?.revision;
        break;
      }
      case 'check': {
        const matches = (checkKind: string) =>
          criterion.id === 'checks' ? CHECK_KINDS_FOR_DEFAULT.has(checkKind) : checkKind === criterion.id;
        // Only checks of the revision that exists now, and not overtaken by an
        // edit while they ran, can say anything about the current code.
        const latest = new Map<string, Extract<Evidence, { kind: 'check' }>>();
        for (const item of evidence)
          if (
            item.kind === 'check' &&
            matches(item.checkKind) &&
            current(item.repositoryId) === item.revision &&
            (item.revisionAfter === undefined || item.revisionAfter === item.revision)
          )
            latest.set(`${item.repositoryId}:${item.checkKind}`, item);
        const results = [...latest.values()];
        if (!results.length) status = 'pending';
        else if (results.every((item) => item.result === 'passed')) status = 'satisfied';
        else status = 'failed'; // failed, skipped, timeout and infrastructure never approve
        refs = results.map((item) => item.artifactId ?? item.fingerprint);
        revision = results.at(-1)?.revision;
        break;
      }
      case 'functional': {
        const checks = evidence.filter(
          (item): item is Extract<Evidence, { kind: 'functional' }> =>
            item.kind === 'functional' && (!item.criterionId || item.criterionId === criterion.id),
        );
        const repositories = [...revisions.values()];
        const latest = checks.filter((item) => repositories.includes(item.revision) || !repositories.length).at(-1);
        status = latest ? (latest.result === 'passed' ? 'satisfied' : 'failed') : 'pending';
        if (latest) {
          refs = [latest.artifactId ?? latest.fingerprint];
          revision = latest.revision;
        }
        break;
      }
      case 'publication': {
        const published = evidence.filter((item): item is Extract<Evidence, { kind: 'publication' }> => item.kind === 'publication' && item.prNumber !== undefined);
        status = published.length ? 'satisfied' : 'pending';
        refs = published.map((item) => item.fingerprint);
        break;
      }
      case 'analysis': {
        const reports = evidence.filter((item) => item.kind === 'report');
        status = reports.length && options.completionProposed ? 'satisfied' : 'pending';
        refs = reports.map((item) => (item.kind === 'report' ? (item.artifactId ?? item.fingerprint) : ''));
        break;
      }
      case 'manual':
        break;
    }
    if (previous === 'satisfied' && status !== 'satisfied') {
      invalidated.push({ id: criterion.id, reason: 'Código ou evidência mudou depois da aprovação.', revision: revision ?? '' });
      if (status === 'pending') status = 'invalidated';
    }
    return { ...criterion, status, evidenceRefs: refs, ...(revision !== undefined && { revision }) };
  });
  return { criteria: next, invalidated, satisfied: next.filter((item) => item.status === 'satisfied').length };
}

export function defaultCriteria(mode: 'change' | 'analysis', allowPublication: boolean): Criterion[] {
  if (mode === 'analysis')
    return [
      {
        id: 'report',
        kind: 'analysis',
        description: 'Relatório de análise entregue, sem alterar o projeto',
        status: 'pending',
        evidenceRefs: [],
      },
    ];
  return [
    { id: 'changes', kind: 'diff', description: 'Alterações aplicadas na worktree da tarefa', status: 'pending', evidenceRefs: [] },
    { id: 'checks', kind: 'check', description: 'Verificações pertinentes aprovadas na revisão atual', status: 'pending', evidenceRefs: [] },
    ...(allowPublication
      ? [{ id: 'draft_pr', kind: 'publication' as const, description: 'Draft PR publicado com a revisão validada', status: 'pending' as const, evidenceRefs: [] }]
      : []),
  ];
}
