import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import { env } from '@/config/env';

const CONNECTION = Symbol.for('@oinko/dashboard/telemetry-db');

interface Holder {
  [CONNECTION]?: DatabaseSync;
}

/** Tabelas sem as quais nenhuma tela funciona. */
const REQUIRED_TABLES = ['executions', 'llm_calls', 'tool_calls', 'payloads'] as const;

function connect(path: string): DatabaseSync {
  try {
    return new DatabaseSync(path, { readOnly: true, timeout: 3_000 });
  } catch (err) {
    // O SDK abre o banco em WAL, e o SQLite recusa abrir um banco WAL em modo
    // somente-leitura quando nao consegue mapear o -shm. query_only da a mesma
    // garantia no nivel do SQL.
    const message = err instanceof Error ? err.message : String(err);
    if (!/SQLITE_CANTOPEN|unable to open/i.test(message)) throw err;

    console.warn(
      `[telemetry] leitura somente-leitura recusada em banco WAL (${message}); ` +
        'reabrindo com PRAGMA query_only',
    );
    const database = new DatabaseSync(path, { timeout: 3_000 });
    database.exec('PRAGMA query_only = ON');
    return database;
  }
}

function assertSchema(database: DatabaseSync, path: string): void {
  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as unknown as { name: string }[];
  const present = new Set(rows.map((row) => row.name));
  const missing = REQUIRED_TABLES.filter((table) => !present.has(table));

  if (missing.length > 0) {
    throw new Error(
      `O banco em ${path} nao tem as tabelas ${missing.join(', ')}. ` +
        'Ligue a telemetria no agente (config.telemetry) e rode ao menos um turno.',
    );
  }
}

/**
 * Conexao unica por processo, somente-leitura.
 *
 * Guardada em globalThis para sobreviver ao hot reload do dev, que sem isso
 * abriria um descritor novo a cada edicao. A dashboard nunca roda migration:
 * quem e dono deste schema e o SDK.
 */
export function telemetryDb(): DatabaseSync {
  const holder = globalThis as unknown as Holder;
  const existing = holder[CONNECTION];
  if (existing) return existing;

  let database: DatabaseSync;
  try {
    database = connect(env.TELEMETRY_DB_PATH);
  } catch (err) {
    throw new Error(`Nao foi possivel abrir ${env.TELEMETRY_DB_PATH}`, { cause: err });
  }

  assertSchema(database, env.TELEMETRY_DB_PATH);
  holder[CONNECTION] = database;
  return database;
}
