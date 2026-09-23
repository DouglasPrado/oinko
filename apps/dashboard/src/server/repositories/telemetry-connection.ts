import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '@/config/env';

const CONNECTION = Symbol.for('@oinko/dashboard/telemetry-databases');

interface Holder {
  [CONNECTION]?: Map<string, DatabaseSync>;
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

/** Conexões somente-leitura, separadas por caminho e reutilizadas durante HMR. */
export function telemetryDb(path = env.TELEMETRY_DB_PATH): DatabaseSync {
  path = resolve(path);
  const holder = globalThis as unknown as Holder;
  const connections = (holder[CONNECTION] ??= new Map<string, DatabaseSync>());
  const existing = connections.get(path);
  if (existing) return existing;
  // O fallback WAL nunca deve criar um banco que o bot ainda não inicializou.
  if (!existsSync(path)) throw new Error('O bot ainda não criou o banco de telemetria.');
  const database = connect(path);
  try {
    assertSchema(database, path);
  } catch (error) {
    database.close();
    throw error;
  }
  connections.set(path, database);
  return database;
}
