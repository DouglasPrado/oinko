import 'server-only';
import { telemetryDb } from './telemetry-connection';
import {
  ThreadSummarySchema,
  type ThreadFilters,
  type ThreadSummary,
} from '@/features/threads/schemas/thread.schema';

interface ThreadRow {
  thread_id: string;
  execution_count: number;
  total_tokens: number;
  cost_usd: number | null;
  unknown_cost_count: number;
  error_count: number;
  last_model: string;
  last_started_at: number;
  total_duration_ms: number;
}

const PAGE_SIZE = 50;

/**
 * Agrega as execucoes por thread.
 *
 * `SUM(cost_usd)` ignora NULL por definicao do SQL, que e exatamente o
 * comportamento correto: execucao sem custo informado nao entra no total e e
 * contada a parte, para a interface poder dizer quantas ficaram de fora em vez
 * de apresentar um numero que parece completo e nao e.
 */
export function listThreads(filters: ThreadFilters): ThreadSummary[] {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filters.q) {
    where.push('thread_id LIKE ?');
    params.push(`%${filters.q}%`);
  }
  if (filters.model) {
    where.push('model LIKE ?');
    params.push(`%${filters.model}%`);
  }
  if (filters.status === 'error') where.push("status = 'error'");
  if (filters.status === 'ok') where.push("status = 'ok'");

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const rows = telemetryDb()
    .prepare(
      `SELECT
         thread_id,
         COUNT(*)                                        AS execution_count,
         COALESCE(SUM(total_tokens), 0)                  AS total_tokens,
         SUM(cost_usd)                                   AS cost_usd,
         SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown_cost_count,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
         MAX(model)                                      AS last_model,
         MAX(started_at)                                 AS last_started_at,
         COALESCE(SUM(duration_ms), 0)                   AS total_duration_ms
       FROM executions
       ${clause}
       GROUP BY thread_id
       ORDER BY last_started_at DESC
       LIMIT ${PAGE_SIZE}`,
    )
    .all(...params) as unknown as ThreadRow[];

  // Validado na fronteira: o schema deste banco pertence ao SDK, e uma coluna
  // que mude de tipo tem que falhar aqui, com nome, e nao virar NaN na tela.
  return rows.map((row) =>
    ThreadSummarySchema.parse({
      threadId: row.thread_id,
      executionCount: row.execution_count,
      totalTokens: row.total_tokens,
      costUsd: row.cost_usd,
      unknownCostCount: row.unknown_cost_count,
      errorCount: row.error_count,
      lastModel: row.last_model,
      lastStartedAt: row.last_started_at,
      totalDurationMs: row.total_duration_ms,
    }),
  );
}
