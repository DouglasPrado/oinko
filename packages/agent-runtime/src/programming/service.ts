import { randomUUID } from 'node:crypto';
import {
  CriterionSchema,
  ProgrammingRunSchema,
  newId,
  newRunId,
  type Actor,
  type ControlKind,
  type Criterion,
  type OperationReceipt,
  type PlanRevision,
  type Publication,
  type ProgrammingRun,
  type RunMode,
  type RunState,
} from './contracts.js';
import { ProgrammingError } from './errors.js';
import {
  SafePointInterrupt,
  assessProgress,
  createRunContext,
  defaultCriteria,
  evaluateCriteria,
  evidenceFingerprint,
  withRunContext,
  type Evidence,
  type RunContext,
} from './evidence.js';
import type { OperationRecorder } from './operations.js';
import { deliveryReport } from './delivery-report.js';
import type { ArtifactStore } from './artifacts.js';
import {
  canAccessRun,
  resolveEffectivePolicy,
  type AccessPort,
  type EffectivePolicy,
} from './policy.js';
import { completionBlockers, isTerminal, validateRunReferences } from './state.js';
import { hashParams, type ProgrammingStore } from './store/programming-store.js';
import type { TelemetryJournal } from './telemetry/journal.js';
import type { UsageLedger } from './usage.js';

export interface CycleInput {
  run: ProgrammingRun;
  cycle: number;
  objective: string;
  plan: PlanRevision;
  /** User directions applied since the previous cycle. */
  directions: string[];
  criteria: Criterion[];
  /** Why a proposed completion was not accepted, to guide the next cycle. */
  feedback?: string;
  previousSummary?: string;
  /** Essential context kept across cycles even when history is reduced (latest per title). */
  pinned?: { title: string; text: string }[];
  context: RunContext;
}

export interface CycleOutcome {
  /** Carried to the next cycle; the full history stays in the run thread. */
  summary: string;
  traceIds: string[];
  /** The model asks to finish; accepted only if criteria hold on evidence. */
  completion?: { summary: string };
  /** The model needs information only a person can give. */
  needsInput?: string;
  planUpdate?: string[];
}

/** Runs one bounded reasoning cycle (e.g. an agent turn with the run tools). */
export interface RunExecutor {
  runCycle(input: CycleInput): Promise<CycleOutcome>;
}

export interface ReconcileResult {
  resolution: 'applied' | 'not_applied' | 'unknown';
  evidence: Record<string, unknown>;
  /** Facts proven by the reconciliation (e.g. the edit's revision), added to the run's evidence. */
  observed?: Evidence[];
}
/** Finds out what really happened to an uncertain operation (files, jobs, Git, PR). */
export interface Reconciler {
  reconcile(run: ProgrammingRun, receipt: OperationReceipt): Promise<ReconcileResult>;
}

export interface StartRunInput {
  botId: string;
  projectId: string;
  taskId?: string;
  repositoryIds?: string[];
  text: string;
  mode?: RunMode;
  criteria?: Omit<Criterion, 'status' | 'evidenceRefs'>[];
  idempotencyKey?: string;
  conversationId?: string;
  previousRunId?: string;
}

export interface StartRunResult {
  run: ProgrammingRun;
  deduplicated: boolean;
  queuePosition: number;
  follow: string;
}

export interface ControlResult {
  status: 'requested' | 'applied' | 'rejected';
  run: ProgrammingRun;
  message: string;
  /** Operations whose outcome is still unknown: stopping is not a rollback. */
  pendingReconciliation: string[];
}

export interface ProgrammingRunServiceOptions {
  store: ProgrammingStore;
  journal: TelemetryJournal;
  access: AccessPort;
  recorder: OperationRecorder;
  usage: UsageLedger;
  artifacts?: ArtifactStore;
  /** Present only in the process that executes runs (the bot worker). */
  executor?: RunExecutor;
  reconciler?: Reconciler;
  /** Which bots this process executes; others are only queued and controlled. */
  serves?: (botId: string) => boolean;
  ownerId?: string;
  leaseTtlMs?: number;
  pollMs?: number;
  /** Called after each cycle, e.g. to collect provider usage by trace. */
  onCycleFinished?: (run: ProgrammingRun, outcome: CycleOutcome) => void | Promise<void>;
  /** Called on relevant state changes, e.g. to notify the originating channel. */
  onRunEvent?: (run: ProgrammingRun, event: { type: string; message: string }) => void;
  /** Reads current code/configuration revisions after each cycle (external changes invalidate evidence). */
  probe?: RevisionProbe;
  /** Authorized page of a run (e.g. the dashboard), included in final messages. */
  runLink?: (run: ProgrammingRun) => string | undefined;
  now?: () => number;
}

interface ActiveExecution {
  run: ProgrammingRun;
  controller: AbortController;
  inFlight: number;
  interrupt?: 'pause' | 'cancel';
  done: Promise<void>;
}

/** The newest observed revision per repository: edits and check observations, in order. */
export function observeRevision(revisions: Map<string, string>, item: Evidence): void {
  if (item.kind === 'edit') revisions.set(item.repositoryId, item.revision);
  else if (item.kind === 'check') revisions.set(item.repositoryId, item.revisionAfter ?? item.revision);
  else if (item.kind === 'revision') revisions.set(item.key, item.revision);
}

/**
 * Current revisions of a run's repositories and relevant configuration
 * (`env:<id>`), read from the environment. Lets the service notice changes
 * made outside the run's own edits before judging criteria.
 */
export type RevisionProbe = (run: ProgrammingRun, known: ReadonlyMap<string, string>) => Promise<Record<string, string> | undefined>;

function correlationOf(run: ProgrammingRun, stepId?: string) {
  return {
    botId: run.botId,
    projectId: run.projectId,
    ...(run.taskId && { taskId: run.taskId }),
    runId: run.id,
    ...(stepId && { stepId }),
    policyVersion: run.policySnapshot.version,
  };
}

/**
 * The single service every interface uses (dashboard, channels, MCP, bot
 * tools). Accepting work, controlling it and executing it are separate: a
 * request returns as soon as it is persisted; execution happens in the bot's
 * process, one active run per bot, surviving disconnects and restarts.
 */
/** What the person said, framed with the question the run was waiting on so the agent knows what it answers. */
function answerFor(run: ProgrammingRun, text: string): string {
  const blocked = run.state === 'blocked' ? run.blocked : undefined;
  if (blocked?.code === 'needs_input' && blocked.needs) return `Resposta da pessoa à sua pergunta «${blocked.needs.slice(0, 800)}»: ${text}`;
  if (blocked) return `Ao retomar o run bloqueado (${blocked.message.slice(0, 300)}), a pessoa disse: ${text}`;
  return `Ao retomar o run, a pessoa disse: ${text}`;
}

export class ProgrammingRunService {
  private readonly store: ProgrammingStore;
  private readonly journal: TelemetryJournal;
  private readonly access: AccessPort;
  private readonly now: () => number;
  private readonly ownerId: string;
  private readonly leaseTtlMs: number;
  private readonly active = new Map<string, ActiveExecution>();
  private kickScheduled = false;
  private dispatching?: Promise<void>;
  private poller?: NodeJS.Timeout;
  private closed = false;

  constructor(private readonly options: ProgrammingRunServiceOptions) {
    this.store = options.store;
    this.journal = options.journal;
    this.access = options.access;
    this.now = options.now ?? Date.now;
    this.ownerId = options.ownerId ?? `owner-${process.pid}-${randomUUID()}`;
    this.leaseTtlMs = options.leaseTtlMs ?? 30_000;
  }

  // ---- requests ------------------------------------------------------------

  start(actor: Actor, input: StartRunInput): StartRunResult {
    if (actor.kind !== 'operator' && actor.botId !== input.botId)
      throw new ProgrammingError('permission_denied', 'Um bot só pode iniciar trabalho em seu próprio nome.');
    const bot = this.access.bot(input.botId);
    if (!bot) throw new ProgrammingError('not_found', 'Bot não encontrado.');
    const project = this.access.project(input.projectId);
    if (!project) throw new ProgrammingError('not_found', 'Projeto não encontrado.');
    const mode = input.mode ?? 'change';
    const snapshot = resolveEffectivePolicy(bot, project, mode);
    const now = this.now();
    const conversationId =
      input.conversationId ??
      (actor.kind === 'channel' ? `${actor.channel}:${actor.conversationId}` : undefined);
    const run = ProgrammingRunSchema.parse({
      id: newRunId(),
      botId: input.botId,
      ...(conversationId && { conversationId }),
      projectId: input.projectId,
      ...(input.taskId && { taskId: input.taskId }),
      repositoryIds: input.repositoryIds ?? project.repositories.map((repository) => repository.id),
      request: {
        text: input.text,
        mode,
        criteria: [],
        ...(actor.kind === 'channel' && { source: { channel: actor.channel, conversationId: actor.conversationId } }),
      },
      ...(input.idempotencyKey && { idempotencyKey: input.idempotencyKey }),
      state: 'queued',
      phase: 'queued',
      policySnapshot: snapshot,
      createdAt: now,
      updatedAt: now,
      ...(input.previousRunId && { previousRunId: input.previousRunId }),
    });
    validateRunReferences(run, project);
    const criteria = input.criteria?.length
      ? input.criteria.map((criterion) => CriterionSchema.parse({ ...criterion, status: 'pending', evidenceRefs: [] }))
      : defaultCriteria(mode, snapshot.policy.allowPublication);
    const result = this.store.transaction(() => {
      const inserted = this.store.insertRun(
        run,
        hashParams([run.projectId, run.taskId, run.repositoryIds, run.request.text, mode, input.criteria ?? null]),
      );
      const saved = inserted.run;
      const correlation = correlationOf(saved);
      if (inserted.deduplicated) {
        this.journal.record('request_deduplicated', correlation, { existingRunId: saved.id });
        return inserted;
      }
      for (const criterion of criteria) this.store.upsertCriterion(saved.id, criterion);
      this.store.addPlanRevision({
        runId: saved.id,
        revision: 0,
        plan: [],
        objective: input.text,
        reason: 'Pedido original',
        source: 'request',
        compatible: true,
        createdAt: now,
      });
      this.journal.record('run_created', correlation, { mode, state: 'queued', phase: 'queued', actorKind: actor.kind });
      this.journal.record('policy_resolved', correlation, {
        version: snapshot.version,
        mode,
        autonomy: snapshot.policy.autonomy,
        allowEdits: snapshot.policy.allowEdits,
        allowPublication: snapshot.policy.allowPublication,
      });
      this.journal.record('capture_policy_applied', correlation, {
        capture: snapshot.policy.telemetry.capture,
        retentionDays: snapshot.policy.telemetry.retentionDays,
      });
      this.journal.record('run_queued', correlation, { position: this.store.queuePosition(saved), state: 'queued' });
      return inserted;
    });
    this.kick();
    return {
      run: result.run,
      deduplicated: result.deduplicated,
      queuePosition: result.run.state === 'queued' ? this.store.queuePosition(result.run) : 0,
      follow: `Acompanhe pelo runId ${result.run.id} (status, dashboard ou MCP).`,
    };
  }

  get(actor: Actor, runId: string): ProgrammingRun {
    const run = this.store.getRun(runId);
    if (!run || !canAccessRun(this.access, actor, run, 'view'))
      throw new ProgrammingError('not_found', 'Run não encontrado.');
    return run;
  }

  /**
   * Control is independent of the queue and of any LLM call: it is persisted
   * and answered at once; the executor applies it at the next safe point.
   */
  control(
    actor: Actor,
    runId: string,
    kind: ControlKind,
    payload: Record<string, unknown> = {},
    via = 'api',
  ): ControlResult {
    const run = this.store.getRun(runId);
    if (!run || !canAccessRun(this.access, actor, run, 'control'))
      throw new ProgrammingError('not_found', 'Run não encontrado.');
    const correlation = correlationOf(run);
    const uncertain = () => this.store.listReceipts(run.id, ['uncertain', 'running', 'intended']).map((r) => r.operationId);
    const reject = (message: string): ControlResult => {
      this.journal.record('control_requested', correlation, { kind, status: 'rejected', interface: via, actorKind: actor.kind }, 'denied');
      return { status: 'rejected', run, message, pendingReconciliation: uncertain() };
    };
    if (isTerminal(run.state)) return reject(`Run já encerrado (${run.state}); inicie um novo run para continuar.`);
    const existing = this.store.pendingControls(run.id).find((control) => control.kind === kind && kind !== 'steer');
    if (existing)
      return {
        status: 'requested',
        run,
        message: 'Pedido já registrado; aguardando o próximo ponto seguro.',
        pendingReconciliation: uncertain(),
      };
    const request = {
      id: newId('ctl'),
      runId: run.id,
      kind,
      status: 'requested' as const,
      actor,
      payload,
      createdAt: this.now(),
    };
    if (kind === 'resume') return this.resume(actor, run, request, via);
    if (kind === 'steer') return this.steer(actor, run, request, via);
    if (kind === 'pause' && run.state === 'paused') return reject('O run já está pausado.');
    if (kind === 'pause' && run.state === 'blocked') return reject('O run está bloqueado; resolva o impedimento ou cancele.');
    const result = this.store.transaction(() => {
      this.store.insertControl(request);
      this.journal.record('control_requested', correlation, { kind, status: 'requested', interface: via, actorKind: actor.kind });
      if (kind === 'cancel' && run.state !== 'running') {
        // Nothing is executing: cancel now. Files, commits and previews stay.
        const pending = uncertain();
        const cancelled = this.finish(run, 'cancelled', {
          summary: 'Cancelado antes de executar.',
          reason: 'cancel',
          uncertainOperations: pending,
        });
        this.store.resolveControl(request.id, 'applied', { state: 'cancelled' });
        this.journal.record('run_cancelled', correlation, { reason: 'cancel', actorKind: actor.kind });
        return { status: 'applied' as const, run: cancelled, message: 'Run cancelado; nada foi revertido.', pendingReconciliation: pending };
      }
      return undefined;
    });
    if (result) return result;
    const execution = this.active.get(run.id);
    if (execution) this.interrupt(execution, kind === 'cancel' ? 'cancel' : 'pause');
    return {
      status: 'requested',
      run: this.store.requireRun(run.id),
      message:
        kind === 'cancel'
          ? 'Cancelamento registrado; processos controlados serão encerrados sem apagar arquivos ou commits.'
          : 'Pausa registrada; o run para no próximo ponto seguro.',
      pendingReconciliation: uncertain(),
    };
  }

  private resume(actor: Actor, run: ProgrammingRun, request: Parameters<ProgrammingStore['insertControl']>[0], via: string): ControlResult {
    const correlation = correlationOf(run);
    if (run.state !== 'paused' && run.state !== 'blocked') {
      this.journal.record('control_requested', correlation, { kind: 'resume', status: 'rejected', interface: via, actorKind: actor.kind }, 'denied');
      return { status: 'rejected', run, message: `Não há o que retomar: o run está ${run.state}.`, pendingReconciliation: [] };
    }
    // Permissions are checked again on resume: a revoked bot cannot continue.
    const bot = this.access.bot(run.botId);
    const project = this.access.project(run.projectId);
    if (!bot?.programming.enabled || !project?.allowedBotIds.includes(run.botId)) {
      this.journal.record('permission_denied', correlation, { class: 'read', operation: 'run.resume', code: 'permission_denied' }, 'denied');
      return { status: 'rejected', run, message: 'O bot não tem mais acesso a este projeto ou à programação.', pendingReconciliation: [] };
    }
    if (run.state === 'blocked' && !String(request.payload.note ?? '').trim()) {
      return {
        status: 'rejected',
        run,
        message: 'Informe como o bloqueio foi resolvido (note) para retomar.',
        pendingReconciliation: [],
      };
    }
    const resumed = this.store.transaction(() => {
      this.store.insertControl(request);
      this.journal.record('control_requested', correlation, { kind: 'resume', status: 'applied', interface: via, actorKind: actor.kind });
      const { run: next } = this.store.transitionRun(run.id, run.revision, 'queued', {
        phase: 'queued',
        noProgressCount: 0,
        clearBlocked: true,
      });
      this.store.resolveControl(request.id, 'applied', { state: 'queued' });
      // The note is what the person answered: the next cycle reads it next to the question.
      const note = String(request.payload.note ?? '').trim();
      if (note)
        this.store.insertControl({ id: newId('ctl'), runId: run.id, kind: 'steer', status: 'requested', actor, payload: { text: answerFor(run, note), source: 'resume' }, createdAt: this.now() });
      this.journal.record('run_state_changed', correlation, { from: run.state, to: 'queued', reason: 'resume' });
      this.journal.record('run_resumed', correlation, { reason: 'user', actorKind: actor.kind, note: String(request.payload.note ?? '') });
      return next;
    });
    this.kick();
    return { status: 'applied', run: resumed, message: 'Run de volta à fila.', pendingReconciliation: [] };
  }

  private steer(actor: Actor, run: ProgrammingRun, request: Parameters<ProgrammingStore['insertControl']>[0], via: string): ControlResult {
    const text = String(request.payload.text ?? '').trim();
    if (!text) throw new ProgrammingError('invalid_request', 'Informe a orientação em texto.');
    const correlation = correlationOf(run);
    const objective = typeof request.payload.objective === 'string' ? request.payload.objective.trim() : undefined;
    const current = this.store.planRevisions(run.id).at(-1)!;
    const incompatible = !!objective && objective !== current.objective;
    // A direction to a run waiting for an answer is that answer: it resumes the run.
    const answers = run.state === 'blocked' && run.blocked?.code === 'needs_input' && !incompatible;
    if (answers) request = { ...request, payload: { ...request.payload, text: answerFor(run, text) } };
    const result = this.store.transaction(() => {
      this.store.insertControl(request);
      this.journal.record('user_direction_received', correlation, { interface: via, actorKind: actor.kind, text });
      if (incompatible && request.payload.confirm !== true) {
        this.journal.record('decision_recorded', correlation, {
          point: 'objective_change',
          choice: 'confirmation_required',
          from: current.objective,
          to: objective,
        });
        this.store.resolveControl(request.id, 'rejected', { reason: 'confirmation_required' });
        return {
          status: 'rejected' as const,
          run,
          message: 'A orientação muda o objetivo do run. Confirme (confirm: true) ou inicie um novo run.',
          pendingReconciliation: [],
        };
      }
      const revision = current.revision + 1;
      this.store.addPlanRevision({
        runId: run.id,
        revision,
        plan: current.plan,
        objective: objective ?? current.objective,
        reason: text,
        source: 'user',
        compatible: !incompatible,
        createdAt: this.now(),
      });
      const criteria = Array.isArray(request.payload.criteria)
        ? (request.payload.criteria as unknown[]).map((criterion) =>
            CriterionSchema.parse({ ...(criterion as object), status: 'pending', evidenceRefs: [] }),
          )
        : undefined;
      if (criteria) {
        for (const previous of this.store.criteria(run.id))
          if (previous.status === 'satisfied')
            this.journal.record('evidence_invalidated', correlation, { criterionId: previous.id, reason: 'criteria_changed' });
        this.store.database.db.prepare('DELETE FROM run_criteria WHERE run_id = ?').run(run.id);
        for (const criterion of criteria) this.store.upsertCriterion(run.id, criterion);
      }
      if (incompatible)
        this.journal.record('decision_recorded', correlation, { point: 'objective_change', choice: 'confirmed', from: current.objective, to: objective });
      this.journal.record('plan_revised', correlation, { revision, source: 'user', compatible: !incompatible });
      let updated = this.store.updateRun(run.id, run.revision, { planRevision: revision });
      // The direction stays pending until a cycle reads it: marking it applied
      // while nothing runs would drop it before the agent ever saw it.
      if (answers) {
        updated = this.store.transitionRun(updated.id, updated.revision, 'queued', { phase: 'queued', noProgressCount: 0, clearBlocked: true }).run;
        this.journal.record('run_state_changed', correlation, { from: 'blocked', to: 'queued', reason: 'answered' });
        this.journal.record('run_resumed', correlation, { reason: 'answered', actorKind: actor.kind });
        return { status: 'applied' as const, run: updated, message: 'Resposta registrada; o run voltou à fila e a lê no próximo ciclo.', pendingReconciliation: [] };
      }
      return {
        status: 'requested' as const,
        run: updated,
        message:
          run.state === 'running'
            ? 'Orientação registrada; será aplicada no próximo ponto seguro, sem criar outro run.'
            : 'Orientação registrada; o agente a lê no próximo ciclo, quando o run voltar a executar.',
        pendingReconciliation: [],
      };
    });
    if (answers) this.kick();
    return result;
  }

  // ---- execution -----------------------------------------------------------

  /** Starts polling for queued work and control requests (worker process only). */
  startWorker(): void {
    if (!this.options.executor) throw new ProgrammingError('internal', 'Este processo não executa runs.');
    this.poller = setInterval(() => this.tick(), this.options.pollMs ?? 500);
    this.poller.unref();
    this.kick();
  }

  private serves(botId: string): boolean {
    return !!this.options.executor && (this.options.serves?.(botId) ?? true);
  }

  kick(): void {
    if (!this.options.executor || this.closed || this.kickScheduled) return;
    this.kickScheduled = true;
    setImmediate(() => {
      this.kickScheduled = false;
      void this.dispatch();
    });
  }

  private tick(): void {
    // Controls written by other processes (dashboard, MCP) reach the executor here.
    for (const execution of this.active.values()) {
      const pending = this.store.pendingControls(execution.run.id);
      if (pending.some((control) => control.kind === 'cancel')) this.interrupt(execution, 'cancel');
      else if (pending.some((control) => control.kind === 'pause')) this.interrupt(execution, 'pause');
      this.store.acquireLease(execution.run.id, this.ownerId, this.leaseTtlMs);
    }
    this.kick();
  }

  /** Waits until everything dispatched so far has settled (tests, shutdown). */
  async idle(): Promise<void> {
    for (;;) {
      await this.dispatching;
      const pending = [...this.active.values()].map((execution) => execution.done);
      if (!pending.length && !this.kickScheduled) return;
      await Promise.all(pending);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  private dispatch(): Promise<void> {
    this.dispatching = (this.dispatching ?? Promise.resolve()).then(async () => {
      if (this.closed) return;
      await this.recover();
      for (const botId of this.store.botsWithLiveRuns()) {
        if (!this.serves(botId)) continue;
        const claimed = this.claim(botId);
        if (claimed) this.launch(claimed);
      }
    });
    return this.dispatching.catch(() => undefined);
  }

  /** Atomically takes the bot's single active slot for its oldest queued run. */
  private claim(botId: string): ProgrammingRun | undefined {
    return this.store.transaction(() => {
      if (this.store.runsInState(botId, ['running']).length) return undefined;
      const next = this.store.runsInState(botId, ['queued'])[0];
      if (!next || !this.store.acquireLease(next.id, this.ownerId, this.leaseTtlMs)) return undefined;
      const queuedAt = next.updatedAt;
      const { run } = this.store.transitionRun(next.id, this.store.requireRun(next.id).revision, 'running', {
        phase: 'planning',
        ...(next.startedAt === undefined && { startedAt: this.now() }),
      });
      const correlation = correlationOf(run);
      this.journal.record('run_state_changed', correlation, { from: 'queued', to: 'running', phase: 'planning' });
      this.journal.record('run_dispatched', correlation, { owner: this.ownerId });
      this.journal.record('queue_wait_measured', correlation, { waitMs: Math.max(0, this.now() - queuedAt) });
      this.options.usage.recordInterval(run.id, 'queue', queuedAt, this.now());
      return run;
    });
  }

  private launch(run: ProgrammingRun, recovering = false): void {
    const execution: ActiveExecution = {
      run,
      controller: new AbortController(),
      inFlight: 0,
      done: Promise.resolve(),
    };
    this.active.set(run.id, execution);
    execution.done = this.execute(execution, recovering)
      .catch((error: unknown) => this.crash(execution, error))
      .finally(() => {
        this.active.delete(run.id);
        this.store.releaseLease(run.id, this.ownerId);
        this.kick();
      });
  }

  private interrupt(execution: ActiveExecution, reason: 'pause' | 'cancel'): void {
    if (execution.interrupt === 'cancel') return;
    execution.interrupt = reason;
    // An LLM call has no external effect: abort it right away. A running tool
    // is let finish (pause) or aborted (cancel) so the outcome is recorded.
    if (reason === 'cancel' || execution.inFlight === 0) execution.controller.abort(new SafePointInterrupt(reason));
  }

  private async execute(execution: ActiveExecution, recovering: boolean): Promise<void> {
    const executor = this.options.executor!;
    let run = execution.run;
    const actor: Actor = { kind: 'system', botId: run.botId, component: 'executor' };
    const seen = new Set(this.store.evidence<Evidence>(run.id).map((item) => evidenceFingerprint(item.value)));
    const revisions = new Map<string, string>();
    for (const item of this.store.evidence<Evidence>(run.id)) observeRevision(revisions, item.value);
    let feedback: string | undefined;
    let previousSummary = this.store.listSteps(run.id).filter((step) => step.kind === 'cycle').at(-1)?.summary;
    // A run resumed by a person may carry operations left uncertain before it
    // stopped; recovery already settled them for a restarted one.
    if (!recovering && (await this.settleUncertain(run))) return;
    this.notify(run, recovering ? 'run_resumed' : 'run_started', recovering ? 'Execução retomada após reinício.' : 'Trabalho iniciado.');
    for (;;) {
      if (this.closed) return;
      run = this.store.requireRun(run.id);
      if (run.state !== 'running') return;
      if (this.applySafePoint(execution, run)) return;
      if (!this.stillAllowed(run)) return;
      const directions = this.consumeDirections(run);
      const pins = new Map<string, string>();
      for (const item of this.store.evidence<Evidence>(run.id)) if (item.value.kind === 'information' && item.value.pin) pins.set(item.value.pin.title, item.value.pin.text);
      const plan = this.store.planRevisions(run.id).at(-1)!;
      const criteria = this.store.criteria(run.id);
      const cycle = run.cycleCount + 1;
      const stepId = newId('step');
      this.store.createStep({
        id: stepId,
        runId: run.id,
        kind: 'cycle',
        status: 'running',
        attempt: 1,
        objective: plan.objective.slice(0, 4000),
        inputRefs: [],
        outputRefs: [],
        evidenceRefs: [],
        traceIds: [],
        createdAt: this.now(),
        startedAt: this.now(),
      });
      run = this.store.updateRun(run.id, run.revision, { currentStepId: stepId, phase: 'working' });
      this.journal.record('step_created', correlationOf(run, stepId), { kind: 'cycle', status: 'running' });
      this.journal.record('cycle_started', correlationOf(run, stepId), { cycle, phase: 'working', directions: directions.length });
      const span = this.journal.span('cycle', correlationOf(run, stepId), { cycle });
      const cycleController = new AbortController();
      const signal = AbortSignal.any([execution.controller.signal, cycleController.signal]);
      const context = createRunContext({
        run,
        stepId,
        actor,
        signal,
        recorder: this.options.recorder,
        revisions,
        interrupt: () => execution.interrupt,
        journal: this.journal,
        ...(this.options.artifacts && { artifacts: this.options.artifacts }),
        onEvidence: (item) => this.store.addEvidence(run.id, stepId, item.kind, evidenceFingerprint(item), item),
        onInterval: (kind, startedAt, endedAt) => this.options.usage.recordInterval(run.id, kind, startedAt, endedAt),
        onOperation: (delta) => {
          execution.inFlight += delta;
          if (execution.inFlight === 0 && execution.interrupt === 'pause') execution.controller.abort(new SafePointInterrupt('pause'));
        },
      });
      const interval = this.options.usage.startInterval(run.id, 'total');
      let outcome: CycleOutcome | undefined;
      let failure: unknown;
      try {
        outcome = await withRunContext(context, () =>
          executor.runCycle({
            run,
            cycle,
            objective: plan.objective,
            plan,
            directions,
            criteria,
            ...(feedback && { feedback }),
            ...(previousSummary && { previousSummary }),
            ...(pins.size && { pinned: [...pins].map(([title, text]) => ({ title, text })) }),
            context,
          }),
        );
      } catch (error) {
        failure = error;
      } finally {
        this.options.usage.endInterval(interval);
      }
      // Declarations made through the control tools count even when the
      // executor returned only text.
      if (outcome) {
        const signals = context.signals;
        outcome = {
          ...outcome,
          ...(signals.completion && !outcome.completion && { completion: signals.completion }),
          ...(signals.needsInput && !outcome.needsInput && { needsInput: signals.needsInput }),
          ...(signals.planUpdate && !outcome.planUpdate && { planUpdate: signals.planUpdate }),
        };
      }
      // Shutdown is not a failure of the work: leave the run for recovery.
      if (this.closed && !execution.interrupt) {
        this.store.updateStep(stepId, { status: 'cancelled', finishedAt: this.now(), summary: 'Interrompido pelo encerramento do processo.' });
        span.finish('failed', { cycle }, { code: 'shutdown', message: 'Processo encerrado', retryable: true });
        return;
      }
      const interrupted =
        failure instanceof SafePointInterrupt ||
        execution.controller.signal.reason instanceof SafePointInterrupt ||
        (signal.aborted && execution.interrupt !== undefined);
      if (failure && !interrupted) {
        const code = failure instanceof ProgrammingError ? failure.code : 'cycle_error';
        const message = failure instanceof Error ? failure.message : 'Falha no ciclo.';
        if (code === 'intent_not_persisted') {
          span.finish('failed', {}, { code, message, retryable: false });
          this.block(run, { code, message: 'Não foi possível registrar a intenção de uma operação; nenhuma mutação foi feita.' });
          return;
        }
        const error: Evidence = { kind: 'error', fingerprint: `${code}:${message.slice(0, 200)}`, message };
        context.evidence.push(error);
        this.store.addEvidence(run.id, stepId, 'error', evidenceFingerprint(error), error);
      }
      this.store.updateStep(stepId, {
        status: interrupted ? 'cancelled' : failure ? 'failed' : 'succeeded',
        finishedAt: this.now(),
        summary: outcome?.summary?.slice(0, 20_000) ?? (failure instanceof Error ? failure.message.slice(0, 2000) : undefined),
        traceIds: outcome?.traceIds ?? [],
        evidenceRefs: context.evidence.map(evidenceFingerprint),
      });
      span.finish(interrupted ? 'failed' : failure ? 'failed' : 'succeeded', { cycle });
      if (outcome) {
        previousSummary = outcome.summary;
        await Promise.resolve(this.options.onCycleFinished?.(run, outcome)).catch(() => undefined);
      }
      run = this.store.requireRun(run.id);
      await this.observeExternal(run, stepId, revisions);
      // Criteria are re-evaluated against all evidence for the current revision.
      const all = this.store.evidence<Evidence>(run.id).map((item) => item.value);
      this.adoptFunctionalCriteria(run.id, all);
      const evaluation = evaluateCriteria(this.store.criteria(run.id), all, revisions, {
        completionProposed: !!outcome?.completion,
      });
      for (const criterion of evaluation.criteria) this.store.upsertCriterion(run.id, criterion);
      for (const item of evaluation.invalidated)
        this.journal.record('evidence_invalidated', correlationOf(run, stepId), { criterionId: item.id, reason: item.reason, revision: item.revision });
      const verdict = assessProgress(context.evidence, seen);
      context.evidence.forEach((item) => seen.add(evidenceFingerprint(item)));
      this.journal.record('progress_assessed', correlationOf(run, stepId), {
        progressed: verdict.progressed,
        verdict: verdict.progressed ? 'progress' : 'no_progress',
        reason: verdict.reason,
        newFacts: verdict.newFacts.length,
      });
      if (interrupted) {
        this.applySafePoint(execution, run);
        return;
      }
      if (verdict.progressed && outcome?.summary)
        this.notify(run, 'cycle_progress', `ciclo ${cycle}: ${outcome.summary.slice(0, 400)}`);
      if (outcome?.planUpdate?.length) {
        const current = this.store.planRevisions(run.id).at(-1)!;
        this.store.addPlanRevision({ ...current, revision: current.revision + 1, plan: outcome.planUpdate, reason: 'Plano atualizado pelo agente', source: 'agent', compatible: true, createdAt: this.now() });
        run = this.store.updateRun(run.id, run.revision, { planRevision: current.revision + 1 });
        this.journal.record('plan_revised', correlationOf(run, stepId), { revision: current.revision + 1, source: 'agent', compatible: true });
      }
      run = this.store.updateRun(run.id, run.revision, { cycleCount: cycle });
      // Retrying against an environment that cannot run the tools would only loop.
      if (context.signals.blocked) {
        this.block(run, { ...context.signals.blocked, stepId });
        return;
      }
      if (outcome?.needsInput) {
        this.block(run, { code: 'needs_input', message: 'O trabalho precisa de uma informação para continuar.', needs: outcome.needsInput.slice(0, 2000), stepId });
        return;
      }
      // An uncertain operation would refuse every completion: settle it now or block naming it.
      if (outcome?.completion && this.store.listReceipts(run.id, ['uncertain']).length && (await this.settleUncertain(run))) return;
      if (outcome?.completion) {
        const blockers = completionBlockers({ operations: this.store.listReceipts(run.id), criteria: evaluation.criteria });
        this.journal.record('acceptance_evaluated', correlationOf(run, stepId), {
          satisfied: evaluation.satisfied,
          total: evaluation.criteria.length,
          verdict: blockers.length ? 'rejected' : 'accepted',
          blockers: blockers.map((blocker) => `${blocker.code}:${blocker.ref}`),
        });
        if (!blockers.length) {
          const publication = evaluation.criteria.some((criterion) => criterion.kind === 'publication' && criterion.status === 'satisfied');
          this.finish(run, 'completed', { summary: outcome.completion.summary, delivery: publication ? 'draft_pr' : 'technical', uncertainOperations: [] });
          this.journal.record('run_completed', correlationOf(run), { outcome: 'completed', delivery: publication ? 'draft_pr' : 'technical' });
          this.notify(this.store.requireRun(run.id), 'run_completed', `${outcome.completion.summary}\n${this.report(run.id)}`.trim());
          return;
        }
        feedback = `A conclusão não foi aceita. Pendências: ${blockers
          .map((blocker) => {
            const criterion = evaluation.criteria.find((item) => item.id === blocker.ref);
            return criterion ? `${criterion.description} (${criterion.status})` : `${blocker.code} ${blocker.ref}`;
          })
          .join('; ')}. Produza a evidência que falta antes de concluir.`;
      } else feedback = undefined;
      const noProgress = verdict.progressed ? 0 : run.noProgressCount + 1;
      run = this.store.updateRun(run.id, run.revision, { noProgressCount: noProgress });
      this.journal.record('checkpoint_saved', correlationOf(run, stepId), { phase: run.phase, reason: 'cycle_end', cycle });
      const limit = (run.policySnapshot.policy as Partial<EffectivePolicy>).cycle?.noProgressLimit ?? 3;
      if (noProgress >= limit) {
        const lastErrors = context.evidence.filter((item) => item.kind === 'error').map((item) => (item.kind === 'error' ? item.message : ''));
        this.block(run, {
          code: 'no_progress',
          message: `${limit} ciclos consecutivos sem progresso verificável. ${verdict.reason}${lastErrors.length ? ` Último erro: ${lastErrors.at(-1)!.slice(0, 500)}` : ''}`,
          stepId,
        });
        return;
      }
      this.journal.record('cycle_continued', correlationOf(run, stepId), { reason: verdict.progressed ? 'progress' : 'retry', noProgress });
    }
  }

  /** Applies pending pause/cancel at a safe point. Returns true when execution must stop. */
  private applySafePoint(execution: ActiveExecution, run: ProgrammingRun): boolean {
    const pending = this.store.pendingControls(run.id);
    const cancel = pending.find((control) => control.kind === 'cancel');
    const pause = pending.find((control) => control.kind === 'pause');
    const target = cancel ?? pause ?? (execution.interrupt ? { kind: execution.interrupt, id: undefined } : undefined);
    if (!target) return false;
    const correlation = correlationOf(run);
    const current = this.store.requireRun(run.id);
    if (current.state !== 'running') return true;
    const pendingOps = this.store.listReceipts(run.id, ['uncertain', 'running', 'intended']).map((receipt) => receipt.operationId);
    if (target.kind === 'cancel') {
      this.store.transaction(() => {
        this.finish(current, 'cancelled', { summary: 'Cancelado pelo usuário.', reason: 'cancel', uncertainOperations: pendingOps });
        if (cancel) this.store.resolveControl(cancel.id, 'applied', { state: 'cancelled', uncertainOperations: pendingOps });
        if (pause) this.store.resolveControl(pause.id, 'superseded', { by: 'cancel' });
        this.journal.record('process_terminated', correlation, { signal: 'abort', escalated: false });
        this.journal.record('run_cancelled', correlation, { reason: 'cancel' });
      });
      this.notify(this.store.requireRun(run.id), 'run_cancelled', 'Run cancelado; arquivos e commits preservados.');
      return true;
    }
    this.store.transaction(() => {
      const { run: paused } = this.store.transitionRun(current.id, current.revision, 'paused', { phase: 'waiting' });
      if (pause) this.store.resolveControl(pause.id, 'applied', { state: 'paused', uncertainOperations: pendingOps });
      this.journal.record('run_state_changed', correlation, { from: 'running', to: 'paused', reason: 'pause' });
      this.journal.record('run_paused', correlation, { reason: 'user' });
      return paused;
    });
    this.notify(this.store.requireRun(run.id), 'run_paused', 'Run pausado no ponto seguro.');
    return true;
  }

  private consumeDirections(run: ProgrammingRun): string[] {
    const directions: string[] = [];
    for (const control of this.store.pendingControls(run.id).filter((item) => item.kind === 'steer')) {
      directions.push(String(control.payload.text ?? ''));
      this.store.resolveControl(control.id, 'applied', { appliedAtCycle: run.cycleCount + 1 });
    }
    return directions.filter(Boolean);
  }

  /** Access is re-checked between cycles: revocation stops the run, capability off pauses it. */
  private stillAllowed(run: ProgrammingRun): boolean {
    const bot = this.access.bot(run.botId);
    const project = this.access.project(run.projectId);
    if (!project?.allowedBotIds.includes(run.botId) || !bot) {
      this.journal.record('permission_denied', correlationOf(run), { class: 'read', operation: 'run.cycle', code: 'permission_denied' }, 'denied');
      this.block(run, { code: 'permission_denied', message: 'O acesso do bot ao projeto foi revogado.' });
      return false;
    }
    if (!bot.programming.enabled) {
      const { run: paused } = this.store.transitionRun(run.id, run.revision, 'paused', { phase: 'waiting' });
      this.journal.record('run_state_changed', correlationOf(paused), { from: 'running', to: 'paused', reason: 'capability_disabled' });
      this.journal.record('run_paused', correlationOf(paused), { reason: 'capability_disabled' });
      return false;
    }
    return true;
  }

  private block(run: ProgrammingRun, reason: NonNullable<ProgrammingRun['blocked']>): void {
    const current = this.store.requireRun(run.id);
    if (current.state !== 'running' && current.state !== 'queued' && current.state !== 'paused') return;
    this.store.transaction(() => {
      this.store.transitionRun(current.id, current.revision, 'blocked', { phase: 'waiting', blocked: reason });
      this.journal.record('run_state_changed', correlationOf(current), { from: current.state, to: 'blocked', code: reason.code });
      this.journal.record('run_blocked', correlationOf(current), { code: reason.code, reason: reason.message, needs: reason.needs ?? '' });
    });
    this.notify(this.store.requireRun(run.id), 'run_blocked', `${reason.needs ? `${reason.message} ${reason.needs}` : reason.message}\n${this.report(run.id)}`.trim());
  }

  /** Real validations, draft links and pending criteria of a run, for final messages. */
  report(runId: string): string {
    const run = this.store.requireRun(runId);
    const link = this.options.runLink?.(run);
    return deliveryReport({
      criteria: this.store.criteria(runId),
      evidence: this.store.evidence<Evidence>(runId).map((item) => item.value),
      publications: this.store.publicationsForRun(runId),
      ...(link && { link }),
    });
  }

  private finish(run: ProgrammingRun, state: 'completed' | 'failed' | 'cancelled', outcome: Omit<NonNullable<ProgrammingRun['finalOutcome']>, 'outcome'>): ProgrammingRun {
    const current = this.store.requireRun(run.id);
    const { run: finished } = this.store.transitionRun(current.id, current.revision, state, {
      phase: 'done',
      finishedAt: this.now(),
      finalOutcome: { outcome: state, ...outcome },
    });
    this.store.releaseWorktrees(run.id);
    this.journal.record('run_state_changed', correlationOf(current), { from: current.state, to: state, reason: outcome.reason ?? state });
    return finished;
  }

  private crash(execution: ActiveExecution, error: unknown): void {
    const run = this.store.getRun(execution.run.id);
    if (!run || run.state !== 'running') return;
    this.block(run, {
      code: 'executor_error',
      message: error instanceof ProgrammingError ? error.message : 'O executor falhou; o estado foi preservado para recuperação.',
    });
  }

  private notify(run: ProgrammingRun, type: string, message: string): void {
    try {
      this.options.onRunEvent?.(run, { type, message });
    } catch {
      // Notifications never change the run.
    }
  }

  // ---- recovery ------------------------------------------------------------

  /**
   * Runs left `running` by a dead executor (expired lease) are reconciled
   * before anything else runs: uncertain effects are investigated, never
   * repeated blindly.
   */
  async recover(): Promise<void> {
    for (const botId of this.store.botsWithLiveRuns()) {
      if (!this.serves(botId)) continue;
      for (const candidate of this.store.runsInState(botId, ['running'])) {
        if (this.active.has(candidate.id)) continue;
        if (candidate.lease && candidate.lease.owner !== this.ownerId && candidate.lease.expiresAt >= this.now()) continue;
        if (!this.store.acquireLease(candidate.id, this.ownerId, this.leaseTtlMs)) continue;
        const run = this.store.updateRun(candidate.id, candidate.revision, { phase: 'recovering' });
        const correlation = correlationOf(run);
        this.journal.record('recovery_started', correlation, { reason: 'lease_expired', owner: this.ownerId });
        this.options.recorder.markInterrupted(run);
        if (await this.settleUncertain(run)) {
          this.store.releaseLease(run.id, this.ownerId);
          continue;
        }
        const current = this.store.requireRun(run.id);
        const policy = current.policySnapshot.policy as Partial<EffectivePolicy>;
        if (!policy.autoResume) {
          const { run: paused } = this.store.transitionRun(current.id, current.revision, 'paused', { phase: 'waiting' });
          this.journal.record('run_state_changed', correlationOf(paused), { from: 'running', to: 'paused', reason: 'auto_resume_disabled' });
          this.journal.record('run_paused', correlationOf(paused), { reason: 'auto_resume_disabled' });
          this.store.releaseLease(run.id, this.ownerId);
          continue;
        }
        if (!this.stillAllowed(current)) {
          this.store.releaseLease(run.id, this.ownerId);
          continue;
        }
        const resumed = this.store.updateRun(current.id, current.revision, { phase: 'working' });
        this.journal.record('run_resumed', correlationOf(resumed), { reason: 'recovery' });
        this.launch(resumed, true);
      }
    }
  }

  /**
   * Investigates the run's uncertain operations with the reconciler. One
   * whose outcome stays unknown blocks the run naming it (returns true):
   * completion would refuse it anyway, so cycles would only loop.
   */
  private async settleUncertain(run: ProgrammingRun): Promise<boolean> {
    let unresolved: OperationReceipt | undefined;
    for (const receipt of this.store.listReceipts(run.id, ['uncertain'])) {
      const result = this.options.reconciler
        ? await this.options.reconciler.reconcile(run, receipt).catch(() => ({ resolution: 'unknown' as const, evidence: { error: 'reconciler_failed' } }))
        : { resolution: 'unknown' as const, evidence: { reason: 'no_reconciler' } };
      this.options.recorder.reconcile(run, receipt.operationId, result.resolution, result.evidence);
      if (result.resolution === 'applied')
        for (const item of result.observed ?? [])
          this.store.addEvidence(run.id, receipt.stepId, item.kind, evidenceFingerprint(item), item);
      if (result.resolution === 'unknown') unresolved ??= receipt;
    }
    if (!unresolved) return false;
    this.journal.record('recovery_blocked', correlationOf(run), { code: 'uncertain_operation', operationKind: unresolved.kind }, 'uncertain');
    this.block(run, {
      code: 'uncertain_operation',
      message: `Não foi possível determinar o resultado de ${unresolved.kind}; nada foi repetido.`,
      operationId: unresolved.operationId,
      needs: 'Confira o efeito (arquivos, job, branch ou PR) e retome informando o que encontrou.',
    });
    return true;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.poller) clearInterval(this.poller);
    // Shutdown is not a user pause: the run stays running and is recovered
    // (reconciled, then resumed) by the next executor.
    for (const execution of this.active.values()) execution.controller.abort(new Error('shutdown'));
    await Promise.all([...this.active.values()].map((execution) => execution.done));
    await this.dispatching?.catch(() => undefined);
  }

  /**
   * Binds the run to the Task (worktree) it prepared. Set once: later tools
   * always use this task, never one chosen by the model per call.
   */
  attachTask(runId: string, taskId: string): ProgrammingRun {
    const run = this.store.requireRun(runId);
    if (run.taskId === taskId) return run;
    if (run.taskId) throw new ProgrammingError('invalid_request', 'Este run já está ligado a outra tarefa.');
    const updated = this.store.updateRun(run.id, run.revision, { taskId });
    this.journal.record('decision_recorded', correlationOf(updated), { point: 'task_selected', choice: taskId });
    return updated;
  }

  /**
   * Records revisions that changed outside the run's own edits (a person
   * editing the worktree, a changed environment). A probe failure only
   * means nothing new was observed; it never approves anything.
   */
  private async observeExternal(run: ProgrammingRun, stepId: string, revisions: Map<string, string>): Promise<void> {
    if (!this.options.probe) return;
    const observed = await this.options.probe(run, revisions).catch(() => undefined);
    for (const [key, revision] of Object.entries(observed ?? {})) {
      if (revisions.get(key) === revision) continue;
      const item: Evidence = { kind: 'revision', key, revision, fingerprint: `${key}:${revision}` };
      this.store.addEvidence(run.id, stepId, item.kind, evidenceFingerprint(item), item);
      observeRevision(revisions, item);
      this.journal.record('revision_observed', correlationOf(run, stepId), { key, revision });
    }
  }

  /**
   * A functional check the agent ran becomes a delivery criterion: once a
   * flow was exercised, completion needs it passing on the current code.
   */
  private adoptFunctionalCriteria(runId: string, evidence: readonly Evidence[]): void {
    const known = new Set(this.store.criteria(runId).map((criterion) => criterion.id));
    for (const item of evidence)
      if (item.kind === 'functional' && item.criterionId && !known.has(item.criterionId)) {
        known.add(item.criterionId);
        this.store.upsertCriterion(runId, {
          id: item.criterionId,
          kind: 'functional',
          description: (item.description ?? `Fluxo funcional ${item.criterionId}`).slice(0, 500),
          status: 'pending',
          evidenceRefs: [],
        });
      }
  }

  /**
   * Records the draft PR of a task repository: one reusable publication per
   * bot/project/task/repository, originated by the first run and updated by
   * later ones. Never marks a PR ready, approved or merged.
   */
  recordPublication(
    runId: string,
    input: {
      repositoryId: string;
      /** Required on the first record of a task repository. */
      branch?: string;
      remoteSha?: string;
      prNumber?: number;
      prUrl?: string;
      prState?: Publication['prState'];
      reconciliationState?: Publication['reconciliationState'];
      checkRefs?: string[];
    },
  ): Publication {
    const run = this.store.requireRun(runId);
    if (!run.taskId) throw new ProgrammingError('invalid_request', 'Run sem tarefa não publica.');
    const identity = { botId: run.botId, projectId: run.projectId, taskId: run.taskId, repositoryId: input.repositoryId };
    const existing = this.store.publication(identity);
    const branch = input.branch ?? existing?.branch;
    if (!branch) throw new ProgrammingError('invalid_request', 'Informe o ramo da primeira publicação.');
    const now = this.now();
    const contributing = new Set(existing?.contributingRunIds ?? []);
    if (existing && existing.originatingRunId !== run.id) contributing.add(run.id);
    return this.store.upsertPublication({
      id: existing?.id ?? newId('pub'),
      ...identity,
      branch,
      originatingRunId: existing?.originatingRunId ?? run.id,
      contributingRunIds: [...contributing],
      ...((input.remoteSha ?? existing?.remoteSha) && { remoteSha: input.remoteSha ?? existing?.remoteSha }),
      ...((input.prNumber ?? existing?.prNumber) && { prNumber: input.prNumber ?? existing?.prNumber }),
      ...((input.prUrl ?? existing?.prUrl) && { prUrl: input.prUrl ?? existing?.prUrl }),
      draft: true,
      prState: input.prState ?? existing?.prState ?? 'unknown',
      checkRefs: input.checkRefs ?? existing?.checkRefs ?? [],
      reconciliationState: input.reconciliationState ?? existing?.reconciliationState ?? 'pending',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  /** States considered in queue order for a bot; exposed for status views. */
  queue(botId: string): ProgrammingRun[] {
    return this.store.runsInState(botId, ['running', 'queued'] satisfies RunState[]);
  }
}
