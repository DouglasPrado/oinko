import type { TelemetryDatabase } from './telemetry-database.js';

/** Tabela e a coluna de tempo pela qual ela expira. Ordem importa: filhas primeiro. */
const SCHEDULE: readonly { table: string; column: string }[] = [
  { table: 'events', column: 'created_at' },
  { table: 'telemetry_events', column: 'occurred_at' },
  { table: 'decisions', column: 'created_at' },
  { table: 'mcp_calls', column: 'started_at' },
  { table: 'tool_calls', column: 'started_at' },
  { table: 'llm_call_injections', column: 'created_at' },
  { table: 'llm_calls', column: 'started_at' },
  { table: 'executions', column: 'started_at' },
  // Por ultimo: um payload e compartilhado por varias execucoes, e sua idade e
  // renovada a cada escrita, entao ele so expira quando parar de ser usado.
  { table: 'payloads', column: 'created_at' },
];

const DEFAULT_BATCH_SIZE = 5_000;
const DAY_MS = 86_400_000;

export interface PurgeOptions {
  retentionDays: number;
  /** Linhas por transacao. Default 5000. */
  batchSize?: number;
  /** Relogio injetavel, para teste. */
  now?: number;
}

export interface PurgeResult {
  /** Linhas removidas por tabela. */
  deleted: Record<string, number>;
  cutoff: number;
}

/**
 * Apaga telemetria mais velha que a janela de retencao.
 *
 * Em lotes, cada um na propria transacao: um unico DELETE cobrindo trinta dias
 * seguraria o unico slot de writer do WAL por segundos, e o agente que escreve
 * no mesmo banco ficaria esperando. Ao final, `incremental_vacuum` devolve as
 * paginas livres ao sistema de arquivos — que so funciona porque o banco foi
 * criado com `auto_vacuum = INCREMENTAL`.
 */
export function purgeTelemetry(database: TelemetryDatabase, options: PurgeOptions): PurgeResult {
  const cutoff = (options.now ?? Date.now()) - options.retentionDays * DAY_MS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const deleted: Record<string, number> = {};

  for (const { table, column } of SCHEDULE) {
    const statement = database.db.prepare(
      `DELETE FROM ${table} WHERE rowid IN (
         SELECT rowid FROM ${table} WHERE ${column} < ? LIMIT ${batchSize}
       )`,
    );

    let removed = 0;
    for (;;) {
      const changes = database.transaction(() => Number(statement.run(cutoff).changes));
      removed += changes;
      if (changes === 0) break;
    }
    deleted[table] = removed;
  }

  database.db.exec('PRAGMA incremental_vacuum(1000)');

  return { deleted, cutoff };
}
