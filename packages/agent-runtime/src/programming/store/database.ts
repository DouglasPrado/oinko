import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProgrammingError } from '../errors.js';
import { PROGRAMMING_MIGRATIONS, type ProgrammingMigration } from './migrations.js';

export interface MigrationReport {
  from: number;
  to: number;
  applied: { version: number; name: string; durationMs: number }[];
  backupPath?: string;
  /** `newer-additive`: written by a newer binary whose extra migrations this one can ignore. */
  compatibility: 'current' | 'newer-additive';
}

export interface ProgrammingDatabaseOptions {
  migrations?: readonly ProgrammingMigration[];
  /** Where pre-migration backups go; defaults to `<dir>/backups`. */
  backupDir?: string;
  now?: () => number;
}

/**
 * SQLite connection for programming runs. Migrations are versioned, each one
 * atomic together with its own record; an existing database is copied before
 * any migration touches it.
 */
export class ProgrammingDatabase {
  private handle?: DatabaseSync;
  private readonly migrations: readonly ProgrammingMigration[];
  private readonly now: () => number;

  constructor(
    readonly path: string,
    private readonly options: ProgrammingDatabaseOptions = {},
  ) {
    this.migrations = [...(options.migrations ?? PROGRAMMING_MIGRATIONS)].sort(
      (a, b) => a.version - b.version,
    );
    this.now = options.now ?? Date.now;
  }

  get db(): DatabaseSync {
    if (!this.handle) throw new ProgrammingError('unavailable', 'Banco de programação fechado.');
    return this.handle;
  }

  open(): MigrationReport {
    if (this.handle) throw new ProgrammingError('internal', 'Banco já aberto.');
    const existed = this.path !== ':memory:' && existsSync(this.path);
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(this.path);
    try {
      if (this.path !== ':memory:') chmodSync(this.path, 0o600);
      db.exec('PRAGMA busy_timeout = 5000');
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = NORMAL');
      db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT    NOT NULL,
        additive   INTEGER NOT NULL DEFAULT 1,
        applied_at INTEGER NOT NULL
      )`);
      this.handle = db;
      return this.migrate(existed);
    } catch (error) {
      this.handle = undefined;
      db.close();
      throw error;
    }
  }

  private migrate(existed: boolean): MigrationReport {
    const db = this.db;
    const rows = db
      .prepare('SELECT version, additive FROM schema_migrations ORDER BY version')
      .all() as { version: number; additive: number }[];
    const known = new Set(this.migrations.map((migration) => migration.version));
    const unknown = rows.filter((row) => !known.has(row.version));
    const from = rows.at(-1)?.version ?? 0;
    if (unknown.some((row) => !row.additive))
      throw new ProgrammingError(
        'unavailable',
        'O banco de programação foi migrado por uma versão mais nova e incompatível. Pare os processos e restaure o backup anterior à migração.',
        { details: { schemaVersion: from } },
      );
    const appliedVersions = new Set(rows.map((row) => row.version));
    const pending = this.migrations.filter((migration) => !appliedVersions.has(migration.version));
    const report: MigrationReport = {
      from,
      to: from,
      applied: [],
      compatibility: unknown.length ? 'newer-additive' : 'current',
    };
    if (!pending.length) return report;
    if (existed && from > 0) report.backupPath = this.backup(this.backupPathFor(from));
    for (const migration of pending) {
      const started = this.now();
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of migration.up) db.exec(statement);
        db.prepare(
          'INSERT INTO schema_migrations (version, name, additive, applied_at) VALUES (?, ?, ?, ?)',
        ).run(migration.version, migration.name, migration.additive ? 1 : 0, this.now());
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw new ProgrammingError(
          'unavailable',
          `Migração ${migration.name} falhou; o banco permanece na versão ${report.to}.`,
          { details: { version: migration.version, cause: (error as Error).message.slice(0, 300) } },
        );
      }
      report.applied.push({
        version: migration.version,
        name: migration.name,
        durationMs: this.now() - started,
      });
      report.to = Math.max(report.to, migration.version);
    }
    return report;
  }

  private backupPathFor(version: number): string {
    const dir = this.options.backupDir ?? join(dirname(this.path), 'backups');
    return join(dir, `${basename(this.path, '.db')}-v${version}-${this.now()}.db`);
  }

  schemaVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
      version: number | null;
    };
    return row.version ?? 0;
  }

  /** Consistent online copy (VACUUM INTO), readable on its own. */
  backup(target: string): string {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    rmSync(target, { force: true });
    this.db.prepare('VACUUM INTO ?').run(target);
    chmodSync(target, 0o600);
    return target;
  }

  /** Runs `action` in one IMMEDIATE transaction; nested calls reuse the outer one. */
  transaction<T>(action: () => T): T {
    const db = this.db;
    // Tracked here instead of `db.isTransaction`, which older Node 22 lacks.
    if (this.depth > 0) return action();
    db.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const result = action();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* the failing statement may already have ended the transaction */
      }
      throw error;
    } finally {
      this.depth--;
    }
  }
  private depth = 0;

  close(): void {
    this.handle?.close();
    this.handle = undefined;
  }
}

/**
 * Replaces the database file with a verified backup. Every process using the
 * database must be stopped first (coordinated stop); WAL side files are
 * removed so they cannot replay newer pages over the restored copy.
 */
export function restoreProgrammingBackup(backupPath: string, targetPath: string): void {
  let probe: DatabaseSync | undefined;
  try {
    probe = new DatabaseSync(backupPath, { readOnly: true });
    const check = probe.prepare('PRAGMA integrity_check').get() as Record<string, string>;
    const version = probe.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
      version: number | null;
    };
    if (Object.values(check)[0] !== 'ok' || !version.version) throw new Error('integrity');
  } catch {
    throw new ProgrammingError('invalid_request', 'Arquivo de backup inválido; nada foi restaurado.');
  } finally {
    probe?.close();
  }
  const staging = `${targetPath}.restore-${process.pid}`;
  copyFileSync(backupPath, staging);
  chmodSync(staging, 0o600);
  for (const suffix of ['-wal', '-shm']) rmSync(`${targetPath}${suffix}`, { force: true });
  renameSync(staging, targetPath);
}
