import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROGRAMMING_MIGRATIONS,
  ProgrammingDatabase,
  restoreProgrammingBackup,
  type ProgrammingMigration,
} from '../../src/programming/index.js';

const roots: string[] = [];
function root() {
  const dir = mkdtempSync(join(tmpdir(), 'oinko-programming-db-'));
  roots.push(dir);
  return dir;
}
afterEach(() => roots.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const V1 = PROGRAMMING_MIGRATIONS.filter((migration) => migration.version === 1);

describe('programming database migrations', () => {
  it('applies every migration once, in order, and records versions', () => {
    const dir = root();
    const db = new ProgrammingDatabase(join(dir, 'programming.db'));
    const report = db.open();
    expect(report.from).toBe(0);
    expect(report.to).toBe(PROGRAMMING_MIGRATIONS.at(-1)!.version);
    expect(report.backupPath).toBeUndefined();
    db.close();
    const again = new ProgrammingDatabase(join(dir, 'programming.db'));
    expect(again.open().applied).toEqual([]);
    again.close();
  });

  it('keeps old data readable after an additive upgrade and backs up before migrating', () => {
    const dir = root();
    const path = join(dir, 'programming.db');
    const old = new ProgrammingDatabase(path, { migrations: V1, backupDir: join(dir, 'backups') });
    old.open();
    old.db
      .prepare(
        `INSERT INTO programming_runs (id, bot_id, project_id, request_json, mode, state, phase,
          policy_snapshot_json, policy_version, created_at, updated_at, queued_at)
         VALUES ('run-1','alpha','loja','{}','change','queued','queued','{}','v',1,1,1)`,
      )
      .run();
    old.close();
    const extra: ProgrammingMigration = {
      version: 99,
      name: 'test-additive',
      additive: true,
      up: ['CREATE TABLE test_additive (id TEXT PRIMARY KEY)'],
    };
    const upgraded = new ProgrammingDatabase(path, {
      migrations: [...PROGRAMMING_MIGRATIONS, extra],
      backupDir: join(dir, 'backups'),
    });
    const report = upgraded.open();
    expect(report.applied.map((migration) => migration.version)).toContain(99);
    expect(report.backupPath && existsSync(report.backupPath)).toBe(true);
    expect(upgraded.db.prepare('SELECT id FROM programming_runs').all()).toEqual([{ id: 'run-1' }]);
    upgraded.close();
  });

  it('rolls back a migration that fails midway and stays readable at the previous version', () => {
    const dir = root();
    const path = join(dir, 'programming.db');
    const first = new ProgrammingDatabase(path);
    first.open();
    const version = first.schemaVersion();
    first.close();
    const broken: ProgrammingMigration = {
      version: version + 1,
      name: 'broken',
      additive: true,
      up: ['CREATE TABLE half_done (id TEXT)', 'THIS IS NOT SQL'],
    };
    const failing = new ProgrammingDatabase(path, {
      migrations: [...PROGRAMMING_MIGRATIONS, broken],
      backupDir: join(dir, 'backups'),
    });
    expect(() => failing.open()).toThrow(/Migração broken falhou/);
    const reopened = new ProgrammingDatabase(path);
    reopened.open();
    expect(reopened.schemaVersion()).toBe(version);
    expect(
      reopened.db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").all(),
    ).toEqual([]);
    reopened.close();
  });

  it('lets an older binary open a newer schema only when the unknown migrations are additive', () => {
    const dir = root();
    const path = join(dir, 'programming.db');
    const additive = new ProgrammingDatabase(path, {
      migrations: [
        ...PROGRAMMING_MIGRATIONS,
        { version: 50, name: 'future-additive', additive: true, up: ['CREATE TABLE f (id TEXT)'] },
      ],
    });
    additive.open();
    additive.close();
    const older = new ProgrammingDatabase(path);
    expect(older.open().compatibility).toBe('newer-additive');
    older.close();
    const breaking = new ProgrammingDatabase(path, {
      migrations: [
        ...PROGRAMMING_MIGRATIONS,
        { version: 50, name: 'future-additive', additive: true, up: ['CREATE TABLE f (id TEXT)'] },
        { version: 51, name: 'future-breaking', additive: false, up: ['CREATE TABLE g (id TEXT)'] },
      ],
    });
    breaking.open();
    breaking.close();
    expect(() => new ProgrammingDatabase(path).open()).toThrow(/restaure o backup/);
  });

  it('restores a verified backup over the current file with a coordinated stop', () => {
    const dir = root();
    const path = join(dir, 'programming.db');
    const db = new ProgrammingDatabase(path);
    db.open();
    db.db.exec("CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES ('before')");
    const backup = db.backup(join(dir, 'manual.db'));
    db.db.exec("UPDATE marker SET value = 'after'");
    db.close();
    restoreProgrammingBackup(backup, path);
    const restored = new ProgrammingDatabase(path);
    restored.open();
    expect(restored.db.prepare('SELECT value FROM marker').get()).toEqual({ value: 'before' });
    restored.close();
    copyFileSync(path, join(dir, 'corrupt.db'));
    const corrupt = join(dir, 'garbage.db');
    copyFileSync(join(dir, 'manual.db'), corrupt);
    // Truncated garbage is refused rather than copied over a working database.
    writeFileSync(corrupt, 'not a database');
    expect(() => restoreProgrammingBackup(corrupt, path)).toThrow(/backup inválido/);
    expect(readdirSync(dir)).toContain('programming.db');
  });
});
