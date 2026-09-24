import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteDatabase } from '../../../src/storage/sqlite-database.js';

describe('SQLiteDatabase', () => {
  let db: SQLiteDatabase;

  afterEach(() => {
    db?.close();
  });

  it('should initialize with in-memory database', () => {
    db = new SQLiteDatabase(':memory:');
    db.initialize();
    expect(db.db).toBeDefined();
  });

  it('should create all required tables on initialize', () => {
    db = new SQLiteDatabase(':memory:');
    db.initialize();

    const tables = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('memories');
    expect(tableNames).toContain('memories_fts');
    expect(tableNames).toContain('vectors');
    expect(tableNames).toContain('conversations');
  });

  // Le um PRAGMA via prepare(): o `node:sqlite` nao tem o atalho `.pragma()`
  // que o better-sqlite3 oferecia.
  const journalMode = (d: SQLiteDatabase): string =>
    (d.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;

  it('should enable WAL mode on file-based databases', () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-db-'));
    db = new SQLiteDatabase(join(dir, 'nested', 'test.db'));
    db.initialize();

    // O `PRAGMA journal_mode = WAL` do initialize() so tem efeito em arquivo —
    // e e justamente por isso que o teste antigo (`:memory:` + toBeDefined())
    // passaria mesmo se o pragma nunca tivesse rodado.
    expect(journalMode(db)).toBe('wal');

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to an in-memory journal for :memory: databases', () => {
    db = new SQLiteDatabase(':memory:');
    db.initialize();

    // WAL exige arquivo; o SQLite recusa a troca e mantem 'memory'.
    expect(journalMode(db)).toBe('memory');
  });

  it('should create indices on conversations', () => {
    db = new SQLiteDatabase(':memory:');
    db.initialize();

    const indices = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='conversations'")
      .all() as { name: string }[];

    const indexNames = indices.map((i) => i.name);
    expect(indexNames).toContain('idx_conversations_thread');
    expect(indexNames).toContain('idx_conversations_pinned');
  });

  it('should create indices on memories', () => {
    db = new SQLiteDatabase(':memory:');
    db.initialize();

    const indices = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memories'")
      .all() as { name: string }[];

    const indexNames = indices.map((i) => i.name);
    expect(indexNames).toContain('idx_memories_scope');
    expect(indexNames).toContain('idx_memories_thread');
    expect(indexNames).toContain('idx_memories_confidence');
  });

  it('should be idempotent on multiple initialize calls', () => {
    db = new SQLiteDatabase(':memory:');
    db.initialize();
    db.initialize(); // should not throw
  });

  it('leaves _db null when migration throws so reinitialize can recover (#218)', () => {
    db = new SQLiteDatabase(':memory:');

    // Force the private migration method to throw on first call
    vi.spyOn(db as unknown as Record<string, () => void>, 'migrateV1').mockImplementationOnce(
      () => {
        throw new Error('Simulated migration failure');
      },
    );

    expect(() => db.initialize()).toThrow('Simulated migration failure');

    // Bug: with the old code _db is already set, so db.db would NOT throw here.
    // After the fix, _db must remain null after a failed migration.
    expect(() => db.db).toThrow('not initialized');

    // A second initialize() attempt must succeed now that the spy is restored.
    expect(() => db.initialize()).not.toThrow();
    const tables = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('conversations');
  });

  it('should close cleanly', () => {
    db = new SQLiteDatabase(':memory:');
    db.initialize();
    db.close();
    // Accessing after close should throw
    expect(() => db.db.prepare('SELECT 1')).toThrow();
  });
});

describe('SQLiteDatabase — conversation search index (migrateV3)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('creates the index and its triggers, idempotently', () => {
    const db = new SQLiteDatabase(':memory:');
    db.initialize();
    const names = (db.db.prepare('SELECT name FROM sqlite_master').all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'conversations_fts',
        'conversations_fts_after_delete',
        'conversations_fts_after_update',
      ]),
    );
    db.close();
  });

  it('backfills text written before the index existed — text only, no tool output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fts-backfill-'));
    dirs.push(dir);
    const path = join(dir, 'data.db');

    // A database from before the index: tables of V1/V2, rows written directly.
    const first = new SQLiteDatabase(path);
    first.initialize();
    first.db.exec(`
      DROP TRIGGER conversations_fts_after_delete;
      DROP TRIGGER conversations_fts_after_update;
      DROP TABLE conversations_fts;
    `);
    const insert = first.db.prepare(
      'INSERT INTO conversations (thread_id, role, content, pinned, created_at) VALUES (?, ?, ?, 0, ?)',
    );
    insert.run('t1', 'user', 'plano de migração do banco', 1);
    insert.run(
      't1',
      'user',
      JSON.stringify([
        { type: 'text', text: 'veja o diagrama' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJDRA==' } },
      ]),
      2,
    );
    insert.run('t1', 'tool', 'resultado buscado migração', 3);
    first.close();

    const second = new SQLiteDatabase(path);
    second.initialize();
    const bodies = (
      second.db.prepare('SELECT rowid, body FROM conversations_fts ORDER BY rowid').all() as {
        body: string;
      }[]
    ).map((r) => r.body);
    second.close();

    expect(bodies).toEqual(['plano de migração do banco', 'veja o diagrama']);
  });
});
