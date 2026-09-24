import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { ProgrammingRun } from './contracts.js';
import type { EffectivePolicy } from './policy.js';
import type { ProgrammingStore } from './store/programming-store.js';
import type { TelemetryJournal } from './telemetry/journal.js';

export const USAGE_ROLES = ['main', 'fast', 'jev', 'summary', 'fallback'] as const;
export type UsageRole = (typeof USAGE_ROLES)[number];
export type CostStatus = 'pending' | 'confirmed' | 'unavailable';

export interface UsageReport {
  /** Provider call identity: the only key used to sum, so redelivery never doubles. */
  callId: string;
  role: UsageRole;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  costStatus: CostStatus;
  aborted?: boolean;
  attempt?: number;
  startedAt: number;
  endedAt?: number;
}

export type IntervalKind = 'queue' | 'context' | 'model' | 'tool' | 'total';

export interface RunMetrics {
  calls: number;
  abortedCalls: number;
  tokens: { input: number; output: number; total: number; byRole: Record<string, number>; byModel: Record<string, number> };
  /** Unknown cost is never zero: `confirmedUsd` covers only confirmed calls. */
  cost: { confirmedUsd: number; confirmedCalls: number; pendingCalls: number; unavailableCalls: number; coverage: number; totalUsd?: number };
  durations: Record<IntervalKind, number>;
}

type Row = Record<string, number | string | null>;

/** Length of the union of [start, end) intervals: overlapping spans are not summed twice. */
export function unionLength(intervals: readonly [number, number][]): number {
  const sorted = intervals.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current: [number, number] | undefined;
  for (const [start, end] of sorted) {
    if (!current || start > current[1]) {
      if (current) total += current[1] - current[0];
      current = [start, end];
    } else current[1] = Math.max(current[1], end);
  }
  if (current) total += current[1] - current[0];
  return total;
}

export class UsageLedger {
  constructor(
    private readonly store: ProgrammingStore,
    private readonly journal: TelemetryJournal,
    private readonly now: () => number = Date.now,
  ) {}

  private get db() {
    return this.store.database.db;
  }

  /**
   * Records one provider call. A repeated report of the same call updates it
   * (late usage, confirmed cost) instead of adding it again.
   */
  report(run: ProgrammingRun, report: UsageReport): 'recorded' | 'reconciled' | 'unchanged' {
    return this.store.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM usage_records WHERE call_id = ?').get(report.callId) as
        | Row
        | undefined;
      const correlation = {
        botId: run.botId,
        projectId: run.projectId,
        runId: run.id,
        policyVersion: run.policySnapshot.version,
      };
      if (!existing) {
        this.db
          .prepare(
            `INSERT INTO usage_records (call_id, run_id, bot_id, project_id, role, model, policy_version,
               input_tokens, output_tokens, total_tokens, cost_usd, cost_status, aborted, attempt, started_at,
               ended_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            report.callId,
            run.id,
            run.botId,
            run.projectId,
            report.role,
            report.model,
            run.policySnapshot.version,
            report.inputTokens ?? null,
            report.outputTokens ?? null,
            report.totalTokens ?? null,
            report.costUsd ?? null,
            report.costStatus,
            report.aborted ? 1 : 0,
            report.attempt ?? 1,
            report.startedAt,
            report.endedAt ?? null,
            this.now(),
          );
        this.journal.record('usage_reported', correlation, {
          callId: report.callId,
          role: report.role,
          model: report.model,
          costStatus: report.costStatus,
          inputTokens: report.inputTokens ?? null,
          outputTokens: report.outputTokens ?? null,
          aborted: report.aborted ?? false,
        });
        return 'recorded';
      }
      const changedCost =
        existing.cost_status !== report.costStatus && existing.cost_status !== 'confirmed';
      const lateTokens = existing.total_tokens === null && report.totalTokens !== undefined;
      if (!changedCost && !lateTokens) return 'unchanged';
      this.db
        .prepare(
          `UPDATE usage_records SET input_tokens = COALESCE(input_tokens, ?), output_tokens = COALESCE(output_tokens, ?),
             total_tokens = COALESCE(total_tokens, ?), cost_usd = COALESCE(?, cost_usd),
             cost_status = CASE WHEN cost_status = 'confirmed' THEN cost_status ELSE ? END, updated_at = ?
           WHERE call_id = ?`,
        )
        .run(
          report.inputTokens ?? null,
          report.outputTokens ?? null,
          report.totalTokens ?? null,
          report.costUsd ?? null,
          report.costStatus,
          this.now(),
          report.callId,
        );
      this.journal.record('usage_reconciled', correlation, {
        callId: report.callId,
        costStatus: report.costStatus,
      });
      return 'reconciled';
    });
  }

  startInterval(runId: string, kind: IntervalKind, startedAt = this.now()): string {
    const spanId = `int-${randomUUID()}`;
    this.db
      .prepare('INSERT INTO run_intervals (span_id, run_id, kind, started_at) VALUES (?, ?, ?, ?)')
      .run(spanId, runId, kind, startedAt);
    return spanId;
  }

  endInterval(spanId: string, endedAt = this.now()): void {
    this.db.prepare('UPDATE run_intervals SET ended_at = ? WHERE span_id = ? AND ended_at IS NULL').run(endedAt, spanId);
  }

  recordInterval(runId: string, kind: IntervalKind, startedAt: number, endedAt: number): void {
    this.endInterval(this.startInterval(runId, kind, startedAt), endedAt);
  }

  metrics(runId: string): RunMetrics {
    return summarize(
      this.db.prepare('SELECT * FROM usage_records WHERE run_id = ?').all(runId) as Row[],
      this.db.prepare('SELECT kind, started_at, ended_at FROM run_intervals WHERE run_id = ?').all(runId) as Row[],
      this.now(),
    );
  }

  /** Emits `run_metrics_updated` with the current totals (never a stop decision). */
  publish(run: ProgrammingRun): RunMetrics {
    const metrics = this.metrics(run.id);
    this.journal.record(
      'run_metrics_updated',
      { botId: run.botId, projectId: run.projectId, runId: run.id, policyVersion: run.policySnapshot.version },
      {
        calls: metrics.calls,
        totalTokens: metrics.tokens.total,
        confirmedUsd: metrics.cost.confirmedUsd,
        costCoverage: metrics.cost.coverage === 1 ? 'complete' : metrics.cost.coverage === 0 ? 'none' : 'partial',
        pendingCalls: metrics.cost.pendingCalls,
        unavailableCalls: metrics.cost.unavailableCalls,
        totalMs: metrics.durations.total,
      },
    );
    return metrics;
  }

  aggregate(
    groupBy: 'run_id' | 'bot_id' | 'project_id' | 'model' | 'policy_version' | 'role',
    filter: { botId?: string; projectId?: string; runIds?: readonly string[] } = {},
  ): Record<string, RunMetrics> {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.botId) {
      clauses.push('bot_id = ?');
      params.push(filter.botId);
    }
    if (filter.projectId) {
      clauses.push('project_id = ?');
      params.push(filter.projectId);
    }
    if (filter.runIds) {
      clauses.push(`run_id IN (${filter.runIds.map(() => '?').join(',') || "''"})`);
      params.push(...filter.runIds);
    }
    const rows = this.db
      .prepare(`SELECT * FROM usage_records ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}`)
      .all(...params) as Row[];
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const key = String(row[groupBy] ?? 'unknown');
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return Object.fromEntries(
      [...groups].map(([key, items]) => [
        key,
        summarize(
          items,
          groupBy === 'run_id'
            ? (this.db.prepare('SELECT kind, started_at, ended_at FROM run_intervals WHERE run_id = ?').all(key) as Row[])
            : [],
          this.now(),
        ),
      ]),
    );
  }

  /**
   * Pulls every provider call of the given traces from the bot's SDK
   * telemetry (main/fast loop calls, context summaries, Jev decisions) and
   * reports it once. Called after each cycle and again to pick up late costs.
   */
  collectFromTelemetry(run: ProgrammingRun, telemetryDbPath: string, traceIds: readonly string[]): number {
    if (!traceIds.length || !existsSync(telemetryDbPath)) return 0;
    const policy = run.policySnapshot.policy as Partial<EffectivePolicy>;
    const fast = policy.models?.fast;
    const db = new DatabaseSync(telemetryDbPath, { readOnly: true });
    let reported = 0;
    try {
      const marks = traceIds.map(() => '?').join(',');
      const calls = db
        .prepare(
          `SELECT id, model, input_tokens, output_tokens, total_tokens, cost_usd, cost_status, attempts,
             cancelled, started_at, ended_at FROM llm_calls WHERE trace_id IN (${marks})`,
        )
        .all(...traceIds) as Row[];
      for (const call of calls) {
        const id = String(call.id);
        const role: UsageRole = id.includes(':summary:') ? 'summary' : fast && call.model === fast ? 'fast' : 'main';
        this.report(run, {
          callId: id,
          role,
          model: String(call.model),
          ...(call.input_tokens !== null && { inputTokens: Number(call.input_tokens) }),
          ...(call.output_tokens !== null && { outputTokens: Number(call.output_tokens) }),
          ...(call.total_tokens !== null && { totalTokens: Number(call.total_tokens) }),
          ...(call.cost_usd !== null && { costUsd: Number(call.cost_usd) }),
          costStatus: call.cost_status as CostStatus,
          aborted: call.cancelled === 1,
          attempt: Number(call.attempts ?? 1),
          startedAt: Number(call.started_at),
          ...(call.ended_at !== null && { endedAt: Number(call.ended_at) }),
        });
        reported++;
      }
      const decisions = db
        .prepare(
          `SELECT id, input_tokens, output_tokens, created_at, duration_ms FROM decisions
           WHERE trace_id IN (${marks}) AND (input_tokens IS NOT NULL OR output_tokens IS NOT NULL)`,
        )
        .all(...traceIds) as Row[];
      for (const decision of decisions) {
        const input = decision.input_tokens === null ? undefined : Number(decision.input_tokens);
        const output = decision.output_tokens === null ? undefined : Number(decision.output_tokens);
        this.report(run, {
          callId: `decision:${decision.id}`,
          role: 'jev',
          model: 'jev',
          ...(input !== undefined && { inputTokens: input }),
          ...(output !== undefined && { outputTokens: output }),
          ...((input !== undefined || output !== undefined) && { totalTokens: (input ?? 0) + (output ?? 0) }),
          // The decider reports tokens but no price: its cost is unknown, not zero.
          costStatus: 'unavailable',
          startedAt: Number(decision.created_at),
          endedAt: Number(decision.created_at) + Number(decision.duration_ms ?? 0),
        });
        reported++;
      }
    } finally {
      db.close();
    }
    return reported;
  }
}

function summarize(rows: Row[], intervals: Row[], now: number): RunMetrics {
  const byRole: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  let input = 0;
  let output = 0;
  let total = 0;
  let confirmedUsd = 0;
  let confirmedCalls = 0;
  let pendingCalls = 0;
  let unavailableCalls = 0;
  let abortedCalls = 0;
  for (const row of rows) {
    const tokens = Number(row.total_tokens ?? 0);
    input += Number(row.input_tokens ?? 0);
    output += Number(row.output_tokens ?? 0);
    total += tokens;
    byRole[String(row.role)] = (byRole[String(row.role)] ?? 0) + tokens;
    byModel[String(row.model)] = (byModel[String(row.model)] ?? 0) + tokens;
    if (row.aborted === 1) abortedCalls++;
    if (row.cost_status === 'confirmed' && row.cost_usd !== null) {
      confirmedUsd += Number(row.cost_usd);
      confirmedCalls++;
    } else if (row.cost_status === 'pending') pendingCalls++;
    else unavailableCalls++;
  }
  const coverage = rows.length ? confirmedCalls / rows.length : 1;
  const durations = {} as Record<IntervalKind, number>;
  for (const kind of ['queue', 'context', 'model', 'tool', 'total'] as const)
    durations[kind] = unionLength(
      intervals
        .filter((row) => row.kind === kind)
        .map((row) => [Number(row.started_at), Number(row.ended_at ?? now)] as [number, number]),
    );
  return {
    calls: rows.length,
    abortedCalls,
    tokens: { input, output, total, byRole, byModel },
    cost: {
      confirmedUsd: Math.round(confirmedUsd * 1e8) / 1e8,
      confirmedCalls,
      pendingCalls,
      unavailableCalls,
      coverage,
      ...(coverage === 1 && rows.length > 0 && { totalUsd: Math.round(confirmedUsd * 1e8) / 1e8 }),
    },
    durations,
  };
}
