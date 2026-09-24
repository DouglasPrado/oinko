import type {
  Actor,
  Artifact,
  Criterion,
  OperationReceipt,
  PlanRevision,
  ProgrammingRun,
  Publication,
  RunState,
  RunStep,
} from './contracts.js';
import { ProgrammingError } from './errors.js';
import { canAccessRun, type AccessPort } from './policy.js';
import type { ProgrammingStore, Page } from './store/programming-store.js';
import { readJournal } from './telemetry/journal.js';
import type { TelemetryJournal } from './telemetry/journal.js';
import type { TelemetryEnvelope } from './telemetry/envelope.js';
import type { RunMetrics, UsageLedger } from './usage.js';

type Row = Record<string, unknown>;

/** Distinct facts a run can reach; one never implies the next. */
export interface DeliveryLevels {
  planned: boolean;
  executed: boolean;
  tested: boolean;
  publishedDraft: boolean;
  acceptedByUser: boolean;
}

export interface RunSummary {
  id: string;
  botId: string;
  projectId: string;
  taskId?: string;
  state: RunState;
  phase: string;
  request: string;
  mode: string;
  createdAt: number;
  updatedAt: number;
  queuePosition?: number;
  blocked?: ProgrammingRun['blocked'];
  pendingControls: string[];
}

export interface RunDetail {
  run: RunSummary & { policyVersion: string; planRevision: number; cycleCount: number; noProgressCount: number; finalOutcome?: ProgrammingRun['finalOutcome'] };
  plan: PlanRevision[];
  criteria: Criterion[];
  steps: RunStep[];
  operations: Pick<OperationReceipt, 'operationId' | 'kind' | 'state' | 'stepId' | 'attempt' | 'createdAt' | 'finishedAt' | 'error' | 'jobId'>[];
  uncertain: string[];
  artifacts: Pick<Artifact, 'id' | 'type' | 'stepId' | 'size' | 'mediaType' | 'capturePolicy' | 'restricted' | 'treeHash' | 'commitSha' | 'createdAt' | 'expiredAt'>[];
  publications: Publication[];
  levels: DeliveryLevels;
  metrics: RunMetrics;
  telemetry: { pendingDelivery: number; gaps: { producer: string; missing: number }[]; degraded: boolean };
  /** How the last cycle's prompt was assembled and which model paths were taken. */
  context: {
    assembled?: Record<string, unknown>;
    tools?: Record<string, unknown>;
    expansions: number;
    retrievals: number;
    fallbacks: number;
    lastRouting?: Record<string, unknown>;
  };
}

export interface TimelineEntry {
  id: number;
  event: TelemetryEnvelope;
}

/**
 * Read side for the dashboard, MCP and channels. Every call checks access
 * against the current authorization and returns summaries and references,
 * never unbounded payloads.
 */
export class RunQueries {
  constructor(
    private readonly store: ProgrammingStore,
    private readonly access: AccessPort,
    private readonly journal: TelemetryJournal,
    private readonly usage: UsageLedger,
  ) {}

  private visible(actor: Actor, run: ProgrammingRun | undefined): ProgrammingRun {
    if (!run || !canAccessRun(this.access, actor, run, 'view'))
      throw new ProgrammingError('not_found', 'Run não encontrado.');
    return run;
  }

  private audit(actor: Actor, scope: string, via: string, runId?: string) {
    // Filter bodies are never stored: only which scope was queried.
    this.journal.record('telemetry_query', { ...(runId && { runId }) }, { interface: via, scope, actorKind: actor.kind });
  }

  summary(run: ProgrammingRun): RunSummary {
    return {
      id: run.id,
      botId: run.botId,
      projectId: run.projectId,
      ...(run.taskId && { taskId: run.taskId }),
      state: run.state,
      phase: run.phase,
      request: run.request.text.slice(0, 500),
      mode: run.request.mode,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      ...(run.state === 'queued' && { queuePosition: this.store.queuePosition(run) }),
      ...(run.blocked && { blocked: run.blocked }),
      pendingControls: this.store.pendingControls(run.id).map((control) => control.kind),
    };
  }

  list(
    actor: Actor,
    filter: { botId?: string; projectId?: string; taskId?: string; states?: RunState[]; cursor?: string; limit?: number },
    via = 'api',
  ): Page<RunSummary> {
    const scoped = { ...filter };
    if (actor.kind !== 'operator') {
      // A bot only lists its own runs in projects it can still access.
      scoped.botId = actor.botId;
      if (filter.botId && filter.botId !== actor.botId) return { items: [] };
      const allowed = this.access.projectIdsFor(actor.botId);
      if (filter.projectId && !allowed.includes(filter.projectId)) return { items: [] };
      Object.assign(scoped, { projectIds: filter.projectId ? [filter.projectId] : allowed });
      if (actor.kind === 'channel') Object.assign(scoped, { conversationId: `${actor.channel}:${actor.conversationId}` });
    }
    this.audit(actor, 'runs', via);
    const page = this.store.listRuns(scoped);
    return { items: page.items.map((run) => this.summary(run)), ...(page.nextCursor && { nextCursor: page.nextCursor }) };
  }

  /** bot → project → task → run tree with state counts. */
  tree(actor: Actor, via = 'api'): { botId: string; projects: { projectId: string; tasks: { taskId: string; runs: Record<string, number> }[] }[] }[] {
    this.audit(actor, 'tree', via);
    const rows = this.store.database.db
      .prepare(
        `SELECT bot_id, project_id, COALESCE(task_id, '-') AS task_id, state, COUNT(*) AS n
         FROM programming_runs GROUP BY bot_id, project_id, task_id, state ORDER BY bot_id, project_id, task_id`,
      )
      .all() as { bot_id: string; project_id: string; task_id: string; state: string; n: number }[];
    const tree = new Map<string, Map<string, Map<string, Record<string, number>>>>();
    for (const row of rows) {
      if (actor.kind !== 'operator' && actor.botId !== row.bot_id) continue;
      if (actor.kind !== 'operator' && !this.access.project(row.project_id)?.allowedBotIds.includes(row.bot_id)) continue;
      const projects = tree.get(row.bot_id) ?? new Map();
      const tasks = projects.get(row.project_id) ?? new Map();
      const counts = tasks.get(row.task_id) ?? {};
      counts[row.state] = row.n;
      tasks.set(row.task_id, counts);
      projects.set(row.project_id, tasks);
      tree.set(row.bot_id, projects);
    }
    return [...tree].map(([botId, projects]) => ({
      botId,
      projects: [...projects].map(([projectId, tasks]) => ({
        projectId,
        tasks: [...tasks].map(([taskId, runs]) => ({ taskId, runs })),
      })),
    }));
  }

  detail(actor: Actor, runId: string, via = 'api'): RunDetail {
    const run = this.visible(actor, this.store.getRun(runId));
    this.audit(actor, 'run', via, run.id);
    const receipts = this.store.listReceipts(run.id);
    const artifacts = (
      this.store.database.db.prepare('SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at').all(run.id) as Row[]
    ).map((row) => ({
      id: String(row.id),
      type: row.type as Artifact['type'],
      ...(row.step_id ? { stepId: String(row.step_id) } : {}),
      size: Number(row.size),
      mediaType: String(row.media_type),
      capturePolicy: row.capture_policy as Artifact['capturePolicy'],
      restricted: row.restricted === 1,
      ...(row.tree_hash ? { treeHash: String(row.tree_hash) } : {}),
      ...(row.commit_sha ? { commitSha: String(row.commit_sha) } : {}),
      createdAt: Number(row.created_at),
      ...(row.expired_at !== null ? { expiredAt: Number(row.expired_at) } : {}),
    }));
    const restrictedHidden = actor.kind !== 'operator' && actor.botId !== run.botId;
    const plan = this.store.planRevisions(run.id);
    const criteria = this.store.criteria(run.id);
    const steps = this.store.listSteps(run.id);
    const publications = this.store.publicationsForRun(run.id);
    const accepted = readJournal(this.store.database, { runId: run.id, type: 'acceptance_reviewed' }).some(
      (event) => event.envelope.payload?.verdict === 'accepted',
    );
    const pending = this.store.database.db
      .prepare('SELECT COUNT(*) AS n FROM telemetry_outbox WHERE run_id = ? AND delivered_at IS NULL')
      .get(run.id) as { n: number };
    return {
      run: {
        ...this.summary(run),
        policyVersion: run.policySnapshot.version,
        planRevision: run.planRevision,
        cycleCount: run.cycleCount,
        noProgressCount: run.noProgressCount,
        ...(run.finalOutcome && { finalOutcome: run.finalOutcome }),
      },
      plan,
      criteria,
      steps,
      operations: receipts.map((receipt) => ({
        operationId: receipt.operationId,
        kind: receipt.kind,
        state: receipt.state,
        ...(receipt.stepId && { stepId: receipt.stepId }),
        attempt: receipt.attempt,
        createdAt: receipt.createdAt,
        ...(receipt.finishedAt !== undefined && { finishedAt: receipt.finishedAt }),
        ...(receipt.error && { error: receipt.error }),
        ...(receipt.jobId && { jobId: receipt.jobId }),
      })),
      uncertain: receipts.filter((receipt) => receipt.state === 'uncertain').map((receipt) => receipt.operationId),
      artifacts: restrictedHidden ? artifacts.filter((artifact) => !artifact.restricted) : artifacts,
      publications,
      levels: {
        planned: plan.length > 0,
        executed: steps.some((step) => step.status === 'succeeded'),
        tested: criteria.some((criterion) => criterion.kind === 'check' && criterion.status === 'satisfied'),
        publishedDraft: publications.some((publication) => publication.prNumber !== undefined),
        acceptedByUser: accepted,
      },
      metrics: this.usage.metrics(run.id),
      telemetry: {
        pendingDelivery: pending.n,
        gaps: this.gaps(run.id),
        degraded: readJournal(this.store.database, { runId: run.id, type: 'telemetry_delivery_degraded' }).length > readJournal(this.store.database, { runId: run.id, type: 'telemetry_recovered' }).length,
      },
      context: this.context(run.id),
    };
  }

  private context(runId: string): RunDetail['context'] {
    const events = (type: string) => readJournal(this.store.database, { runId, type });
    const last = (type: string) => events(type).at(-1)?.envelope.payload;
    const assembled = last('context_assembled');
    const tools = last('tools_selected');
    const lastRouting = last('routing_decision');
    return {
      ...(assembled && { assembled }),
      ...(tools && { tools }),
      expansions: events('tools_expanded').length,
      retrievals: events('history_retrieved').length,
      fallbacks: events('model_fallback_triggered').length,
      ...(lastRouting && { lastRouting }),
    };
  }

  /** Events of a run in journal order; `afterId` pages without duplicates while new events arrive. */
  timeline(
    actor: Actor,
    runId: string,
    options: { afterId?: number; limit?: number; types?: string[] } = {},
    via = 'api',
  ): { entries: TimelineEntry[]; nextAfterId?: number } {
    const run = this.visible(actor, this.store.getRun(runId));
    this.audit(actor, 'timeline', via, run.id);
    const limit = Math.max(1, Math.min(500, options.limit ?? 100));
    const events = readJournal(this.store.database, {
      runId: run.id,
      ...(options.afterId !== undefined && { afterId: options.afterId }),
      limit: limit + 1,
    }).filter((event) => !options.types || options.types.includes(event.envelope.type));
    const entries = events.slice(0, limit).map((event) => ({ id: event.id, event: event.envelope }));
    return { entries, ...(events.length > limit && { nextAfterId: entries.at(-1)!.id }) };
  }

  /** Why is this run blocked, and which operation is responsible? */
  explain(actor: Actor, runId: string): { state: RunState; reason?: ProgrammingRun['blocked']; operation?: OperationReceipt; lastEvents: TelemetryEnvelope[] } {
    const run = this.visible(actor, this.store.getRun(runId));
    const operationId = run.blocked?.operationId ?? this.store.listReceipts(run.id, ['uncertain']).at(-1)?.operationId;
    const operation = operationId ? this.store.getReceipt(operationId) : undefined;
    const lastEvents = readJournal(this.store.database, { runId: run.id })
      .slice(-10)
      .map((event) => event.envelope);
    return { state: run.state, ...(run.blocked && { reason: run.blocked }), ...(operation && { operation }), lastEvents };
  }

  /** Missing sequence numbers per producer for this run: shown as gaps, never hidden. */
  private gaps(runId: string): { producer: string; missing: number }[] {
    const rows = this.store.database.db
      .prepare('SELECT producer, MIN(seq) AS lo, MAX(seq) AS hi, COUNT(*) AS n FROM telemetry_outbox GROUP BY producer')
      .all() as { producer: string; lo: number; hi: number; n: number }[];
    const producers = new Set(
      (this.store.database.db.prepare('SELECT DISTINCT producer FROM telemetry_outbox WHERE run_id = ?').all(runId) as { producer: string }[]).map(
        (row) => row.producer,
      ),
    );
    return rows
      .filter((row) => producers.has(row.producer) && row.hi - row.lo + 1 > row.n)
      .map((row) => ({ producer: row.producer, missing: row.hi - row.lo + 1 - row.n }));
  }
}
