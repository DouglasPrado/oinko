import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runInTransaction } from '../storage/sqlite-transaction.js';
import { TELEMETRY_MIGRATIONS, type TelemetryMigration } from './migrations.js';

export interface TelemetryDatabaseOptions {
  /** Sobrescreve o conjunto de migrations. Existe para teste e para migracao parcial. */
  migrations?: readonly TelemetryMigration[];
}

const SCHEMA_MIGRATIONS = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  applied_at INTEGER NOT NULL
)`;

/**
 * Conexao com o banco de telemetria, com migrations versionadas.
 *
 * Nao herda de `SQLiteDatabase` porque aquela classe tem as migrations do SDK
 * fixas no `initialize()` e nao aceita injecao; herdar exigiria mudar a
 * superficie publica dela. O que as duas de fato compartilham — a transacao —
 * mora em `storage/sqlite-transaction.ts`.
 *
 * Diferente do `data.db`, aqui existe tabela de versao: cada migration e
 * aplicada dentro de uma transacao que tambem grava a propria linha, entao ou
 * a migration inteira entrou, ou nem ela nem o registro dela.
 */
export class TelemetryDatabase {
  private _db: DatabaseSync | null = null;
  private readonly migrations: readonly TelemetryMigration[];

  constructor(
    private readonly path: string,
    options?: TelemetryDatabaseOptions,
  ) {
    this.migrations = options?.migrations ?? TELEMETRY_MIGRATIONS;
  }

  get db(): DatabaseSync {
    if (!this._db) throw new Error('Telemetry database not initialized. Call initialize() first.');
    return this._db;
  }

  initialize(): void {
    if (this._db) return;

    if (this.path !== ':memory:') {
      mkdirSync(dirname(this.path), { recursive: true });
    }

    const db = new DatabaseSync(this.path);

    // auto_vacuum vem primeiro e nao e detalhe de ordem: ele so pode mudar
    // enquanto o banco ainda nao tem header, e definir journal_mode = WAL ja
    // escreve esse header. Invertido, o pragma e aceito calado e fica em 0, e a
    // purga por retencao nunca devolve espaco sem um VACUUM completo.
    db.exec('PRAGMA auto_vacuum = INCREMENTAL');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    // Multi-processo: esperar o writer em vez de estourar SQLITE_BUSY.
    db.exec('PRAGMA busy_timeout = 5000');

    try {
      db.exec(SCHEMA_MIGRATIONS);
      this._db = db;
      this.migrate(this.migrations);
    } catch (err) {
      this._db = null;
      db.close();
      throw err;
    }
  }

  /** Aplica as migrations ainda nao registradas, em ordem de versao. */
  migrate(migrations: readonly TelemetryMigration[]): void {
    const db = this.db;
    const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as
      { version: number | null } | undefined;
    const current = row?.version ?? 0;

    const record = db.prepare(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
    );

    for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
      if (migration.version <= current) continue;

      runInTransaction(db, () => {
        for (const statement of migration.up) db.exec(statement);
        record.run(migration.version, migration.name, Date.now());
      });
    }
  }

  /** Roda `fn` dentro de uma transacao, revertendo tudo se ela lancar. */
  transaction<T>(fn: () => T): T {
    return runInTransaction(this.db, fn);
  }

  close(): void {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }
}
