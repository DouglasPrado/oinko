import { randomUUID } from 'node:crypto';
import type { Actor, OperationReceipt, ProgrammingRun } from './contracts.js';
import { ProgrammingError } from './errors.js';
import {
  checkOperation,
  type AccessPort,
  type ExplicitAuthorization,
  type OperationClass,
} from './policy.js';
import { hashParams, type ProgrammingStore } from './store/programming-store.js';
import { redactValue } from './telemetry/redaction.js';
import type { TelemetryJournal } from './telemetry/journal.js';

/** Thrown by an effect when it knows nothing happened (validation, refused precondition). */
export class KnownFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'KnownFailure';
  }
}

export interface OperationSpec {
  kind: string;
  class: OperationClass;
  params: unknown;
  /** Defaults to a hash of actor + kind + params: the same request is the same operation. */
  idempotencyKey?: string;
  intent?: Record<string, unknown>;
  preconditions?: Record<string, unknown>;
  stepId?: string;
  target?: string;
  grant?: ExplicitAuthorization;
}

export interface OperationContext {
  operationId: string;
  attemptId: string;
  attempt: number;
  idempotencyKey: string;
  /** Lets the effect bind the receipt to an executor job before it finishes. */
  bindExecutor(executorId: string, jobId?: string): void;
}

export interface OperationOutcome<T> {
  result: T;
  receipt: OperationReceipt;
  /** True when a previous success was returned instead of executing again. */
  replayed: boolean;
}

function actorKey(actor: Actor): string {
  switch (actor.kind) {
    case 'operator':
      return `operator:${actor.id}`;
    case 'channel':
      return `channel:${actor.botId}:${actor.channel}:${actor.conversationId}`;
    default:
      return `${actor.kind}:${actor.botId}`;
  }
}

/** Receipts keep only a bounded, redacted copy of results; full content goes to artifacts. */
function compact(value: unknown): unknown {
  const text = JSON.stringify(redactValue(value) ?? null);
  return text.length > 16_000 ? { truncated: true, preview: text.slice(0, 16_000) } : JSON.parse(text);
}

/**
 * Wraps every effect of a run: authorization at the operation, intent
 * persisted before the effect, result after it, uncertainty when the outcome
 * cannot be known. A success is never executed twice for the same key.
 */
export class OperationRecorder {
  constructor(
    private readonly store: ProgrammingStore,
    private readonly journal: TelemetryJournal,
    private readonly access: AccessPort,
    private readonly now: () => number = Date.now,
  ) {}

  async run<T>(
    run: ProgrammingRun,
    actor: Actor,
    spec: OperationSpec,
    effect: (context: OperationContext) => Promise<T>,
  ): Promise<OperationOutcome<T>> {
    const correlation = {
      botId: run.botId,
      projectId: run.projectId,
      ...(run.taskId && { taskId: run.taskId }),
      runId: run.id,
      ...(spec.stepId && { stepId: spec.stepId }),
      policyVersion: run.policySnapshot.version,
    };
    const decision = checkOperation(
      this.access,
      run,
      { class: spec.class, name: spec.kind, ...(spec.target !== undefined && { target: spec.target }) },
      spec.grant,
      this.now(),
    );
    if (!decision.allowed) {
      this.journal.record(
        'permission_denied',
        correlation,
        { class: spec.class, operation: spec.kind, code: decision.code!, reason: decision.reason },
        'denied',
      );
      throw new ProgrammingError(
        decision.code === 'not_found' ? 'permission_denied' : decision.code!,
        decision.reason,
      );
    }
    this.journal.record('permission_checked', correlation, {
      class: spec.class,
      operation: spec.kind,
      decision: 'allowed',
    });
    const paramsHash = hashParams(spec.params);
    const idempotencyKey =
      spec.idempotencyKey ?? hashParams([actorKey(actor), spec.kind, paramsHash]);
    const existing = this.store.receiptByKey(run.id, idempotencyKey);
    if (existing && existing.paramsHash !== paramsHash)
      throw new ProgrammingError(
        'idempotency_conflict',
        'A mesma chave de idempotência foi usada com parâmetros diferentes.',
        { operationId: existing.operationId },
      );
    if (existing?.state === 'succeeded')
      return { result: existing.result as T, receipt: existing, replayed: true };
    if (existing && existing.state !== 'failed')
      throw new ProgrammingError(
        'uncertain_operation',
        'Operação anterior com o mesmo pedido ainda não tem resultado confirmado; reconcilie antes de repetir.',
        { operationId: existing.operationId },
      );
    const attempt = (existing?.attempt ?? 0) + 1;
    const attemptId = `att-${randomUUID()}`;
    const operationId = existing?.operationId ?? `op-${randomUUID()}`;
    const opCorrelation = { ...correlation, operationId, attemptId, attempt };
    const intent = (redactValue(spec.intent ?? {}) as Record<string, unknown>) ?? {};
    // Intent first, in one transaction with its event. If this fails, nothing ran.
    this.store.transaction(() => {
      const value = existing
        ? this.store.updateReceipt(operationId, {
            state: 'intended',
            attempt,
            attemptId,
            error: undefined,
            finishedAt: undefined,
          })
        : this.store.insertReceipt({
            operationId,
            runId: run.id,
            ...(spec.stepId && { stepId: spec.stepId }),
            kind: spec.kind,
            idempotencyKey,
            paramsHash,
            actor,
            intent,
            preconditions: (redactValue(spec.preconditions ?? {}) as Record<string, unknown>) ?? {},
            state: 'intended',
            attempt,
            attemptId,
            createdAt: this.now(),
          });
      this.journal.record('operation_intended', opCorrelation, { kind: spec.kind, class: spec.class }, 'started');
      return value;
    });
    this.store.updateReceipt(operationId, { state: 'running', startedAt: this.now() });
    const started = this.now();
    try {
      const result = await effect({
        operationId,
        attemptId,
        attempt,
        idempotencyKey,
        bindExecutor: (executorId, jobId) => {
          this.store.updateReceipt(operationId, { executorId, ...(jobId && { jobId }) });
        },
      });
      const receipt = this.store.transaction(() => {
        const value = this.store.updateReceipt(operationId, {
          state: 'succeeded',
          result: compact(result),
          finishedAt: this.now(),
        });
        this.journal.emit({
          type: 'operation_finished',
          status: 'succeeded',
          ...opCorrelation,
          durationMs: this.now() - started,
          payload: { kind: spec.kind, state: 'succeeded' },
        });
        return value;
      });
      return { result, receipt, replayed: false };
    } catch (error) {
      const known = error instanceof KnownFailure || spec.class === 'read';
      const code =
        error instanceof KnownFailure
          ? error.code
          : error instanceof ProgrammingError
            ? error.code
            : 'effect_error';
      const message = error instanceof Error ? error.message : 'Falha na operação.';
      const structured = { code, message: String(redactValue(message)).slice(0, 2000), retryable: !known };
      this.store.transaction(() => {
        this.store.updateReceipt(operationId, {
          state: known ? 'failed' : 'uncertain',
          error: structured,
          finishedAt: this.now(),
        });
        this.journal.emit({
          type: known ? 'operation_finished' : 'operation_uncertain',
          status: known ? 'failed' : 'uncertain',
          ...opCorrelation,
          durationMs: this.now() - started,
          error: structured,
          payload: { kind: spec.kind, state: known ? 'failed' : 'uncertain' },
        });
      });
      throw error;
    }
  }

  /**
   * Closes an uncertain receipt from evidence gathered by a reconciler.
   * `unknown` keeps it uncertain: absence of proof is not proof of absence.
   */
  reconcile(
    run: ProgrammingRun,
    operationId: string,
    resolution: 'applied' | 'not_applied' | 'unknown',
    evidence: Record<string, unknown>,
  ): OperationReceipt {
    return this.store.transaction(() => {
      const current = this.store.getReceipt(operationId);
      if (!current || current.runId !== run.id)
        throw new ProgrammingError('not_found', 'Recibo não encontrado.');
      const observed = redactValue(evidence) as Record<string, unknown>;
      const next =
        resolution === 'applied'
          ? this.store.updateReceipt(operationId, {
              state: 'succeeded',
              observedEffects: observed,
              reconciledAt: this.now(),
            })
          : resolution === 'not_applied'
            ? this.store.updateReceipt(operationId, {
                state: 'failed',
                observedEffects: observed,
                error: { code: 'not_applied', message: 'Reconciliação comprovou que o efeito não ocorreu.', retryable: true },
                reconciledAt: this.now(),
              })
            : this.store.updateReceipt(operationId, { state: 'uncertain', observedEffects: observed });
      this.journal.record(
        'operation_reconciled',
        {
          botId: run.botId,
          projectId: run.projectId,
          runId: run.id,
          operationId,
          policyVersion: run.policySnapshot.version,
        },
        { kind: current.kind, resolution, state: next.state },
        resolution === 'unknown' ? 'uncertain' : 'succeeded',
      );
      return next;
    });
  }

  /**
   * After a crash: an intent never marked running provably did not start;
   * anything running has an unknown outcome.
   */
  markInterrupted(run: ProgrammingRun): OperationReceipt[] {
    return this.store.transaction(() =>
      this.store.listReceipts(run.id, ['intended', 'running']).map((receipt) => {
        const correlation = {
          botId: run.botId,
          projectId: run.projectId,
          runId: run.id,
          operationId: receipt.operationId,
          policyVersion: run.policySnapshot.version,
        };
        if (receipt.state === 'intended') {
          const next = this.store.updateReceipt(receipt.operationId, {
            state: 'failed',
            error: { code: 'interrupted_before_start', message: 'Interrompido antes de iniciar.', retryable: true },
            finishedAt: this.now(),
          });
          this.journal.record('operation_finished', correlation, { kind: receipt.kind, state: 'failed' }, 'failed');
          return next;
        }
        const next = this.store.updateReceipt(receipt.operationId, { state: 'uncertain' });
        this.journal.record(
          'operation_uncertain',
          correlation,
          { kind: receipt.kind, state: 'uncertain', reason: 'interrupted' },
          'uncertain',
        );
        return next;
      }),
    );
  }
}
