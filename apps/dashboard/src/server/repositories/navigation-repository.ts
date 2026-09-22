import 'server-only';
import { telemetryDb } from './telemetry-connection';

export interface NavThread {
  threadId: string;
  executionCount: number;
  lastStartedAt: number;
  errorCount: number;
}

export interface NavExecution {
  traceId: string;
  model: string;
  status: string;
  startedAt: number;
  durationMs: number | null;
  totalTokens: number;
  costUsd: number | null;
}

/** Threads para a barra lateral: so o que cabe numa linha densa. */
export function navThreads(limit = 60): NavThread[] {
  const rows = telemetryDb()
    .prepare(
      `SELECT thread_id, COUNT(*) AS n, MAX(started_at) AS last,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
       FROM executions GROUP BY thread_id ORDER BY last DESC LIMIT ${limit}`,
    )
    .all() as unknown as { thread_id: string; n: number; last: number; errors: number }[];

  return rows.map((row) => ({
    threadId: row.thread_id,
    executionCount: row.n,
    lastStartedAt: row.last,
    errorCount: row.errors,
  }));
}

/** Execucoes de uma thread, para aninhar sob ela na barra lateral. */
export function navExecutions(threadId: string, limit = 100): NavExecution[] {
  const rows = telemetryDb()
    .prepare(
      `SELECT trace_id, model, status, started_at, duration_ms, total_tokens, cost_usd
       FROM executions WHERE thread_id = ?
       ORDER BY started_at DESC, trace_id DESC LIMIT ${limit}`,
    )
    .all(threadId) as unknown as {
    trace_id: string;
    model: string;
    status: string;
    started_at: number;
    duration_ms: number | null;
    total_tokens: number;
    cost_usd: number | null;
  }[];

  return rows.map((row) => ({
    traceId: row.trace_id,
    model: row.model,
    status: row.status,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    totalTokens: row.total_tokens,
    costUsd: row.cost_usd,
  }));
}
