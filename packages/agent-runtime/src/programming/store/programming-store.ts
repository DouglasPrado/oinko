import { createHash } from 'node:crypto';
import {
  ControlRequestSchema,
  CriterionSchema,
  OperationReceiptSchema,
  PlanRevisionSchema,
  ProgrammingRunSchema,
  PublicationSchema,
  RunStepSchema,
  type ControlRequest,
  type Criterion,
  type OperationReceipt,
  type OperationState,
  type PlanRevision,
  type ProgrammingRun,
  type Publication,
  type RunState,
  type RunStep,
} from '../contracts.js';
import { ProgrammingError } from '../errors.js';
import { assertTransition } from '../state.js';
import type { ProgrammingDatabase } from './database.js';

type Row = Record<string, unknown>;
const json = (value: unknown) => JSON.stringify(value ?? null);
const parse = <T>(value: unknown, fallback: T): T =>
  typeof value === 'string' && value !== 'null' ? (JSON.parse(value) as T) : fallback;
const opt = <T>(value: T | null | undefined): T | undefined => (value === null ? undefined : value);

export function hashParams(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')}`;
}

function runFromRow(row: Row): ProgrammingRun {
  return ProgrammingRunSchema.parse({
    id: row.id,
    contractVersion: row.contract_version,
    botId: row.bot_id,
    conversationId: opt(row.conversation_id),
    projectId: row.project_id,
    taskId: opt(row.task_id),
    repositoryIds: parse(row.repository_ids_json, []),
    request: parse(row.request_json, {}),
    idempotencyKey: opt(row.idempotency_key),
    state: row.state,
    phase: row.phase,
    planRevision: row.plan_revision,
    policySnapshot: parse(row.policy_snapshot_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    currentStepId: opt(row.current_step_id),
    lease:
      row.lease_owner && row.lease_expires_at
        ? { owner: row.lease_owner, expiresAt: row.lease_expires_at }
        : undefined,
    cycleCount: row.cycle_count,
    noProgressCount: row.no_progress_count,
    blocked: parse(row.blocked_json, undefined),
    finalOutcome: parse(row.final_json, undefined),
    previousRunId: opt(row.previous_run_id),
    startedAt: opt(row.started_at),
    finishedAt: opt(row.finished_at),
  });
}

function stepFromRow(row: Row): RunStep {
  return RunStepSchema.parse({
    id: row.id,
    runId: row.run_id,
    kind: row.kind,
    status: row.status,
    attempt: row.attempt,
    objective: row.objective,
    inputRefs: parse(row.input_refs_json, []),
    outputRefs: parse(row.output_refs_json, []),
    evidenceRefs: parse(row.evidence_refs_json, []),
    traceIds: parse(row.trace_ids_json, []),
    summary: opt(row.summary),
    createdAt: row.created_at,
    startedAt: opt(row.started_at),
    finishedAt: opt(row.finished_at),
  });
}

function receiptFromRow(row: Row): OperationReceipt {
  return OperationReceiptSchema.parse({
    operationId: row.operation_id,
    runId: row.run_id,
    stepId: opt(row.step_id),
    kind: row.kind,
    idempotencyKey: row.idempotency_key,
    paramsHash: row.params_hash,
    actor: parse(row.actor_json, {}),
    executorId: opt(row.executor_id),
    jobId: opt(row.job_id),
    intent: parse(row.intent_json, {}),
    preconditions: parse(row.preconditions_json, {}),
    state: row.state,
    resultRef: opt(row.result_ref),
    result: parse(row.result_json, undefined),
    error: parse(row.error_json, undefined),
    observedEffects: parse(row.observed_effects_json, undefined),
    attempt: row.attempt,
    attemptId: opt(row.attempt_id),
    createdAt: row.created_at,
    startedAt: opt(row.started_at),
    finishedAt: opt(row.finished_at),
    reconciledAt: opt(row.reconciled_at),
  });
}

export interface RunListFilter {
  botId?: string;
  botIds?: readonly string[];
  projectId?: string;
  projectIds?: readonly string[];
  taskId?: string;
  conversationId?: string;
  states?: readonly RunState[];
  /** Only runs created at or after this instant. */
  createdAfter?: number;
  /** Opaque cursor from a previous page; stable for the same data. */
  cursor?: string;
  limit?: number;
}
export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

function encodeCursor(createdAt: number, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString('base64url');
}
function decodeCursor(cursor: string): [number, string] {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'string')
      return [value[0], value[1]];
  } catch {
    /* fall through */
  }
  throw new ProgrammingError('invalid_request', 'Cursor de paginação inválido.');
}

export type RunPatch = Partial<
  Pick<
    ProgrammingRun,
    | 'phase'
    | 'planRevision'
    | 'currentStepId'
    | 'cycleCount'
    | 'noProgressCount'
    | 'blocked'
    | 'finalOutcome'
    | 'startedAt'
    | 'finishedAt'
    | 'taskId'
    | 'repositoryIds'
  >
> & { clearBlocked?: boolean };

/** Persistence for runs and everything hanging off them. SQL lives only here. */
export class ProgrammingStore {
  constructor(
    readonly database: ProgrammingDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  private get db() {
    return this.database.db;
  }

  transaction<T>(action: () => T): T {
    return this.database.transaction(action);
  }

  // ---- runs -------------------------------------------------------------

  /**
   * Inserts a run, or returns the existing one for the same bot and
   * idempotency key. The same key with a different request is a conflict.
   */
  insertRun(run: ProgrammingRun, requestHash: string): { run: ProgrammingRun; deduplicated: boolean } {
    return this.transaction(() => {
      if (run.idempotencyKey) {
        const existing = this.db
          .prepare('SELECT * FROM programming_runs WHERE bot_id = ? AND idempotency_key = ?')
          .get(run.botId, run.idempotencyKey) as Row | undefined;
        if (existing) {
          if (existing.request_hash !== requestHash)
            throw new ProgrammingError(
              'idempotency_conflict',
              'A mesma chave de idempotência foi usada com outro pedido.',
            );
          return { run: runFromRow(existing), deduplicated: true };
        }
      }
      this.db
        .prepare(
          `INSERT INTO programming_runs (id, contract_version, bot_id, conversation_id, project_id,
             task_id, repository_ids_json, request_json, mode, idempotency_key, request_hash, state,
             phase, plan_revision, policy_snapshot_json, policy_version, revision, cycle_count,
             no_progress_count, previous_run_id, created_at, updated_at, queued_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?)`,
        )
        .run(
          run.id,
          run.contractVersion,
          run.botId,
          run.conversationId ?? null,
          run.projectId,
          run.taskId ?? null,
          json(run.repositoryIds),
          json(run.request),
          run.request.mode,
          run.idempotencyKey ?? null,
          requestHash,
          run.state,
          run.phase,
          run.planRevision,
          json(run.policySnapshot),
          run.policySnapshot.version,
          run.previousRunId ?? null,
          run.createdAt,
          run.updatedAt,
          run.createdAt,
        );
      return { run: this.getRun(run.id)!, deduplicated: false };
    });
  }

  getRun(id: string): ProgrammingRun | undefined {
    const row = this.db.prepare('SELECT * FROM programming_runs WHERE id = ?').get(id) as
      | Row
      | undefined;
    return row ? runFromRow(row) : undefined;
  }

  requireRun(id: string): ProgrammingRun {
    const run = this.getRun(id);
    if (!run) throw new ProgrammingError('not_found', 'Run não encontrado.');
    return run;
  }

  listRuns(filter: RunListFilter = {}): Page<ProgrammingRun> {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    const inList = (column: string, values: readonly string[]) => {
      if (!values.length) clauses.push('0');
      else {
        clauses.push(`${column} IN (${values.map(() => '?').join(',')})`);
        params.push(...values);
      }
    };
    if (filter.botId) {
      clauses.push('bot_id = ?');
      params.push(filter.botId);
    }
    if (filter.botIds) inList('bot_id', filter.botIds);
    if (filter.projectId) {
      clauses.push('project_id = ?');
      params.push(filter.projectId);
    }
    if (filter.projectIds) inList('project_id', filter.projectIds);
    if (filter.taskId) {
      clauses.push('task_id = ?');
      params.push(filter.taskId);
    }
    if (filter.conversationId) {
      clauses.push('conversation_id = ?');
      params.push(filter.conversationId);
    }
    if (filter.states) inList('state', filter.states);
    if (filter.createdAfter !== undefined) {
      clauses.push('created_at >= ?');
      params.push(filter.createdAfter);
    }
    if (filter.cursor) {
      const [createdAt, id] = decodeCursor(filter.cursor);
      clauses.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(createdAt, createdAt, id);
    }
    const limit = Math.max(1, Math.min(100, filter.limit ?? 20));
    const rows = this.db
      .prepare(
        `SELECT * FROM programming_runs ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(...params, limit + 1) as Row[];
    const items = rows.slice(0, limit).map(runFromRow);
    const last = items.at(-1);
    return {
      items,
      ...(rows.length > limit && last && { nextCursor: encodeCursor(last.createdAt, last.id) }),
    };
  }

  /** Compare-and-swap update: a stale revision never overwrites plan or progress. */
  updateRun(id: string, expectedRevision: number, patch: RunPatch): ProgrammingRun {
    return this.transaction(() => {
      const current = this.requireRun(id);
      if (current.revision !== expectedRevision)
        throw new ProgrammingError('revision_conflict', 'O run foi alterado por outro processo.', {
          details: { expected: expectedRevision, actual: current.revision },
        });
      const set: string[] = ['revision = revision + 1', 'updated_at = ?'];
      const params: (string | number | null)[] = [this.now()];
      const column = (name: string, value: string | number | null) => {
        set.push(`${name} = ?`);
        params.push(value);
      };
      if (patch.phase !== undefined) column('phase', patch.phase);
      if (patch.planRevision !== undefined) column('plan_revision', patch.planRevision);
      if (patch.currentStepId !== undefined) column('current_step_id', patch.currentStepId);
      if (patch.cycleCount !== undefined) column('cycle_count', patch.cycleCount);
      if (patch.noProgressCount !== undefined) column('no_progress_count', patch.noProgressCount);
      if (patch.blocked !== undefined) column('blocked_json', json(patch.blocked));
      if (patch.clearBlocked) column('blocked_json', null);
      if (patch.finalOutcome !== undefined) column('final_json', json(patch.finalOutcome));
      if (patch.startedAt !== undefined) column('started_at', patch.startedAt);
      if (patch.finishedAt !== undefined) column('finished_at', patch.finishedAt);
      if (patch.taskId !== undefined) column('task_id', patch.taskId);
      if (patch.repositoryIds !== undefined) column('repository_ids_json', json(patch.repositoryIds));
      const result = this.db
        .prepare(`UPDATE programming_runs SET ${set.join(', ')} WHERE id = ? AND revision = ?`)
        .run(...params, id, expectedRevision);
      if (Number(result.changes) !== 1)
        throw new ProgrammingError('revision_conflict', 'O run foi alterado por outro processo.');
      return this.requireRun(id);
    });
  }

  /** Validated state change, also compare-and-swap. */
  transitionRun(
    id: string,
    expectedRevision: number,
    to: RunState,
    patch: RunPatch = {},
  ): { run: ProgrammingRun; from: RunState } {
    return this.transaction(() => {
      const current = this.requireRun(id);
      if (current.revision !== expectedRevision)
        throw new ProgrammingError('revision_conflict', 'O run foi alterado por outro processo.');
      assertTransition(current.state, to);
      const updated = this.updateRun(id, expectedRevision, patch);
      this.db
        .prepare('UPDATE programming_runs SET state = ? WHERE id = ? AND revision = ?')
        .run(to, id, updated.revision);
      if (to === 'queued')
        this.db.prepare('UPDATE programming_runs SET queued_at = ? WHERE id = ?').run(this.now(), id);
      return { run: this.requireRun(id), from: current.state };
    });
  }

  runsInState(botId: string, states: readonly RunState[]): ProgrammingRun[] {
    return (
      this.db
        .prepare(
          // rowid breaks ties in insertion order: FIFO even within one millisecond.
          `SELECT * FROM programming_runs WHERE bot_id = ? AND state IN (${states.map(() => '?').join(',')})
           ORDER BY queued_at, rowid`,
        )
        .all(botId, ...states) as Row[]
    ).map(runFromRow);
  }

  botsWithLiveRuns(): string[] {
    return (
      this.db
        .prepare(
          "SELECT DISTINCT bot_id FROM programming_runs WHERE state IN ('queued','running','paused','blocked')",
        )
        .all() as { bot_id: string }[]
    ).map((row) => row.bot_id);
  }

  queuePosition(run: ProgrammingRun): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM programming_runs AS other, programming_runs AS self
         WHERE self.id = ? AND other.bot_id = self.bot_id AND other.state = 'queued'
           AND (other.queued_at < self.queued_at OR (other.queued_at = self.queued_at AND other.rowid < self.rowid))`,
      )
      .get(run.id) as { n: number };
    return row.n;
  }

  /**
   * Executor lease: only one process owns a run at a time. Taking over needs
   * the previous lease to be expired; renewing needs to be the owner.
   */
  acquireLease(runId: string, owner: string, ttlMs: number): boolean {
    const now = this.now();
    const result = this.db
      .prepare(
        `UPDATE programming_runs SET lease_owner = ?, lease_expires_at = ?
         WHERE id = ? AND (lease_owner IS NULL OR lease_owner = ? OR lease_expires_at < ?)`,
      )
      .run(owner, now + ttlMs, runId, owner, now);
    return Number(result.changes) === 1;
  }

  releaseLease(runId: string, owner: string): void {
    this.db
      .prepare(
        'UPDATE programming_runs SET lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND lease_owner = ?',
      )
      .run(runId, owner);
  }

  // ---- steps ------------------------------------------------------------

  createStep(step: RunStep): RunStep {
    const value = RunStepSchema.parse(step);
    this.db
      .prepare(
        `INSERT INTO run_steps (id, run_id, kind, status, attempt, objective, input_refs_json,
           output_refs_json, evidence_refs_json, trace_ids_json, summary, created_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.runId,
        value.kind,
        value.status,
        value.attempt,
        value.objective,
        json(value.inputRefs),
        json(value.outputRefs),
        json(value.evidenceRefs),
        json(value.traceIds),
        value.summary ?? null,
        value.createdAt,
        value.startedAt ?? null,
        value.finishedAt ?? null,
      );
    return value;
  }

  updateStep(id: string, patch: Partial<Omit<RunStep, 'id' | 'runId' | 'kind' | 'createdAt'>>): RunStep {
    const current = this.getStep(id);
    if (!current) throw new ProgrammingError('not_found', 'Passo não encontrado.');
    const next = RunStepSchema.parse({ ...current, ...patch });
    this.db
      .prepare(
        `UPDATE run_steps SET status = ?, attempt = ?, objective = ?, input_refs_json = ?,
           output_refs_json = ?, evidence_refs_json = ?, trace_ids_json = ?, summary = ?,
           started_at = ?, finished_at = ? WHERE id = ?`,
      )
      .run(
        next.status,
        next.attempt,
        next.objective,
        json(next.inputRefs),
        json(next.outputRefs),
        json(next.evidenceRefs),
        json(next.traceIds),
        next.summary ?? null,
        next.startedAt ?? null,
        next.finishedAt ?? null,
        id,
      );
    return next;
  }

  getStep(id: string): RunStep | undefined {
    const row = this.db.prepare('SELECT * FROM run_steps WHERE id = ?').get(id) as Row | undefined;
    return row ? stepFromRow(row) : undefined;
  }

  listSteps(runId: string, options: { afterCreatedAt?: number; limit?: number } = {}): RunStep[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM run_steps WHERE run_id = ? AND created_at >= ? ORDER BY created_at, id LIMIT ?',
        )
        .all(runId, options.afterCreatedAt ?? 0, options.limit ?? 1000) as Row[]
    ).map(stepFromRow);
  }

  // ---- operation receipts ----------------------------------------------

  insertReceipt(receipt: OperationReceipt): OperationReceipt {
    const value = OperationReceiptSchema.parse(receipt);
    this.db
      .prepare(
        `INSERT INTO operation_receipts (operation_id, run_id, step_id, kind, idempotency_key,
           params_hash, actor_json, executor_id, job_id, intent_json, preconditions_json, state,
           attempt, attempt_id, created_at, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.operationId,
        value.runId,
        value.stepId ?? null,
        value.kind,
        value.idempotencyKey,
        value.paramsHash,
        json(value.actor),
        value.executorId ?? null,
        value.jobId ?? null,
        json(value.intent),
        json(value.preconditions),
        value.state,
        value.attempt,
        value.attemptId ?? null,
        value.createdAt,
        value.startedAt ?? null,
      );
    return value;
  }

  receiptByKey(runId: string, idempotencyKey: string): OperationReceipt | undefined {
    const row = this.db
      .prepare('SELECT * FROM operation_receipts WHERE run_id = ? AND idempotency_key = ?')
      .get(runId, idempotencyKey) as Row | undefined;
    return row ? receiptFromRow(row) : undefined;
  }

  getReceipt(operationId: string): OperationReceipt | undefined {
    const row = this.db
      .prepare('SELECT * FROM operation_receipts WHERE operation_id = ?')
      .get(operationId) as Row | undefined;
    return row ? receiptFromRow(row) : undefined;
  }

  updateReceipt(
    operationId: string,
    patch: Partial<
      Pick<
        OperationReceipt,
        | 'state'
        | 'executorId'
        | 'jobId'
        | 'resultRef'
        | 'result'
        | 'error'
        | 'observedEffects'
        | 'attempt'
        | 'attemptId'
        | 'startedAt'
        | 'finishedAt'
        | 'reconciledAt'
      >
    >,
  ): OperationReceipt {
    const current = this.getReceipt(operationId);
    if (!current) throw new ProgrammingError('not_found', 'Recibo não encontrado.');
    const next = OperationReceiptSchema.parse({ ...current, ...patch });
    this.db
      .prepare(
        `UPDATE operation_receipts SET state = ?, executor_id = ?, job_id = ?, result_ref = ?,
           result_json = ?, error_json = ?, observed_effects_json = ?, attempt = ?, attempt_id = ?,
           started_at = ?, finished_at = ?, reconciled_at = ? WHERE operation_id = ?`,
      )
      .run(
        next.state,
        next.executorId ?? null,
        next.jobId ?? null,
        next.resultRef ?? null,
        next.result === undefined ? null : json(next.result),
        next.error ? json(next.error) : null,
        next.observedEffects ? json(next.observedEffects) : null,
        next.attempt,
        next.attemptId ?? null,
        next.startedAt ?? null,
        next.finishedAt ?? null,
        next.reconciledAt ?? null,
        operationId,
      );
    return next;
  }

  listReceipts(runId: string, states?: readonly OperationState[]): OperationReceipt[] {
    const rows = states
      ? this.db
          .prepare(
            `SELECT * FROM operation_receipts WHERE run_id = ? AND state IN (${states.map(() => '?').join(',')})
             ORDER BY created_at, operation_id`,
          )
          .all(runId, ...states)
      : this.db
          .prepare('SELECT * FROM operation_receipts WHERE run_id = ? ORDER BY created_at, operation_id')
          .all(runId);
    return (rows as Row[]).map(receiptFromRow);
  }

  // ---- control, plan and criteria ---------------------------------------

  insertControl(request: ControlRequest): ControlRequest {
    const value = ControlRequestSchema.parse(request);
    this.db
      .prepare(
        `INSERT INTO control_requests (id, run_id, kind, status, actor_json, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(value.id, value.runId, value.kind, value.status, json(value.actor), json(value.payload), value.createdAt);
    return value;
  }

  pendingControls(runId: string): ControlRequest[] {
    return this.controls(runId).filter((control) => control.status === 'requested');
  }

  controls(runId: string): ControlRequest[] {
    return (
      this.db
        .prepare('SELECT * FROM control_requests WHERE run_id = ? ORDER BY created_at, id')
        .all(runId) as Row[]
    ).map((row) =>
      ControlRequestSchema.parse({
        id: row.id,
        runId: row.run_id,
        kind: row.kind,
        status: row.status,
        actor: parse(row.actor_json, {}),
        payload: parse(row.payload_json, {}),
        response: parse(row.response_json, undefined),
        createdAt: row.created_at,
        appliedAt: opt(row.applied_at),
      }),
    );
  }

  resolveControl(id: string, status: 'applied' | 'rejected' | 'superseded', response: Record<string, unknown>): void {
    this.db
      .prepare(
        "UPDATE control_requests SET status = ?, response_json = ?, applied_at = ? WHERE id = ? AND status = 'requested'",
      )
      .run(status, json(response), this.now(), id);
  }

  addPlanRevision(revision: PlanRevision): PlanRevision {
    const value = PlanRevisionSchema.parse(revision);
    this.db
      .prepare(
        `INSERT INTO plan_revisions (run_id, revision, plan_json, objective, reason, source, compatible, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.runId,
        value.revision,
        json(value.plan),
        value.objective,
        value.reason,
        value.source,
        value.compatible ? 1 : 0,
        value.createdAt,
      );
    return value;
  }

  planRevisions(runId: string): PlanRevision[] {
    return (
      this.db
        .prepare('SELECT * FROM plan_revisions WHERE run_id = ? ORDER BY revision')
        .all(runId) as Row[]
    ).map((row) =>
      PlanRevisionSchema.parse({
        runId: row.run_id,
        revision: row.revision,
        plan: parse(row.plan_json, []),
        objective: row.objective,
        reason: row.reason,
        source: row.source,
        compatible: row.compatible === 1,
        createdAt: row.created_at,
      }),
    );
  }

  upsertCriterion(runId: string, criterion: Criterion): Criterion {
    const value = CriterionSchema.parse(criterion);
    this.db
      .prepare(
        `INSERT INTO run_criteria (run_id, id, description, kind, status, evidence_refs_json, revision, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, id) DO UPDATE SET description = excluded.description, kind = excluded.kind,
           status = excluded.status, evidence_refs_json = excluded.evidence_refs_json,
           revision = excluded.revision, updated_at = excluded.updated_at`,
      )
      .run(
        runId,
        value.id,
        value.description,
        value.kind,
        value.status,
        json(value.evidenceRefs),
        value.revision ?? null,
        this.now(),
      );
    return value;
  }

  criteria(runId: string): Criterion[] {
    return (
      this.db.prepare('SELECT * FROM run_criteria WHERE run_id = ? ORDER BY id').all(runId) as Row[]
    ).map((row) =>
      CriterionSchema.parse({
        id: row.id,
        description: row.description,
        kind: row.kind,
        status: row.status,
        evidenceRefs: parse(row.evidence_refs_json, []),
        revision: opt(row.revision),
      }),
    );
  }

  // ---- publications -----------------------------------------------------

  upsertPublication(publication: Publication): Publication {
    const value = PublicationSchema.parse(publication);
    this.db
      .prepare(
        `INSERT INTO publications (id, bot_id, project_id, task_id, repository_id, branch,
           originating_run_id, contributing_run_ids_json, remote_sha, pr_number, pr_url, pr_state,
           check_refs_json, reconciliation_state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(bot_id, project_id, task_id, repository_id) DO UPDATE SET branch = excluded.branch,
           contributing_run_ids_json = excluded.contributing_run_ids_json, remote_sha = excluded.remote_sha,
           pr_number = excluded.pr_number, pr_url = excluded.pr_url, pr_state = excluded.pr_state,
           check_refs_json = excluded.check_refs_json, reconciliation_state = excluded.reconciliation_state,
           updated_at = excluded.updated_at`,
      )
      .run(
        value.id,
        value.botId,
        value.projectId,
        value.taskId,
        value.repositoryId,
        value.branch,
        value.originatingRunId,
        json(value.contributingRunIds),
        value.remoteSha ?? null,
        value.prNumber ?? null,
        value.prUrl ?? null,
        value.prState,
        json(value.checkRefs),
        value.reconciliationState,
        value.createdAt,
        value.updatedAt,
      );
    return this.publication(value)!;
  }

  publication(identity: Pick<Publication, 'botId' | 'projectId' | 'taskId' | 'repositoryId'>): Publication | undefined {
    const row = this.db
      .prepare(
        'SELECT * FROM publications WHERE bot_id = ? AND project_id = ? AND task_id = ? AND repository_id = ?',
      )
      .get(identity.botId, identity.projectId, identity.taskId, identity.repositoryId) as Row | undefined;
    return row ? publicationFromRow(row) : undefined;
  }

  publicationsForRun(runId: string): Publication[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM publications WHERE originating_run_id = ?
           OR EXISTS (SELECT 1 FROM json_each(contributing_run_ids_json) WHERE value = ?) ORDER BY repository_id`,
        )
        .all(runId, runId) as Row[]
    ).map(publicationFromRow);
  }

  // ---- evidence -----------------------------------------------------------

  addEvidence(runId: string, stepId: string | undefined, kind: string, fingerprint: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO run_evidence (run_id, step_id, kind, fingerprint, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(runId, stepId ?? null, kind, fingerprint, json(value), this.now());
  }

  evidence<T = unknown>(runId: string): { stepId?: string; value: T }[] {
    return (
      this.db
        .prepare('SELECT step_id, evidence_json FROM run_evidence WHERE run_id = ? ORDER BY id')
        .all(runId) as Row[]
    ).map((row) => ({
      ...(row.step_id ? { stepId: String(row.step_id) } : {}),
      value: parse(row.evidence_json, undefined as T),
    }));
  }

  // ---- worktree leases --------------------------------------------------

  /** Serializes writers across bots on the same worktree. */
  acquireWorktree(projectId: string, taskId: string, repositoryId: string, runId: string, ttlMs: number): boolean {
    const now = this.now();
    const result = this.db
      .prepare(
        `INSERT INTO worktree_leases (project_id, task_id, repository_id, owner_run_id, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, task_id, repository_id) DO UPDATE SET owner_run_id = excluded.owner_run_id,
           expires_at = excluded.expires_at
         WHERE worktree_leases.owner_run_id = excluded.owner_run_id OR worktree_leases.expires_at < ?`,
      )
      .run(projectId, taskId, repositoryId, runId, now + ttlMs, now);
    return Number(result.changes) === 1;
  }

  worktreeOwner(projectId: string, taskId: string, repositoryId: string): string | undefined {
    const row = this.db
      .prepare(
        'SELECT owner_run_id, expires_at FROM worktree_leases WHERE project_id = ? AND task_id = ? AND repository_id = ?',
      )
      .get(projectId, taskId, repositoryId) as { owner_run_id: string; expires_at: number } | undefined;
    return row && row.expires_at >= this.now() ? row.owner_run_id : undefined;
  }

  releaseWorktrees(runId: string): void {
    this.db.prepare('DELETE FROM worktree_leases WHERE owner_run_id = ?').run(runId);
  }
}

function publicationFromRow(row: Row): Publication {
  return PublicationSchema.parse({
    id: row.id,
    botId: row.bot_id,
    projectId: row.project_id,
    taskId: row.task_id,
    repositoryId: row.repository_id,
    branch: row.branch,
    originatingRunId: row.originating_run_id,
    contributingRunIds: parse(row.contributing_run_ids_json, []),
    remoteSha: opt(row.remote_sha),
    prNumber: opt(row.pr_number),
    prUrl: opt(row.pr_url),
    prState: row.pr_state,
    checkRefs: parse(row.check_refs_json, []),
    reconciliationState: row.reconciliation_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
