import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TelemetryDatabase } from '../../../src/telemetry/telemetry-database.js';
import {
  TELEMETRY_MIGRATIONS,
  type TelemetryMigration,
} from '../../../src/telemetry/migrations.js';

let dir: string | undefined;
const open: TelemetryDatabase[] = [];

afterEach(async () => {
  for (const db of open.splice(0)) db.close();
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

async function tempPath(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'telemetry-db-'));
  return join(dir, 'telemetry.db');
}

function track(db: TelemetryDatabase): TelemetryDatabase {
  open.push(db);
  return db;
}

function pragma(db: TelemetryDatabase, name: string): unknown {
  const row = db.db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
  return row?.[name];
}

function tableNames(db: TelemetryDatabase): string[] {
  const rows = db.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as unknown as { name: string }[];
  return rows.map((row) => row.name);
}

describe('TelemetryDatabase', () => {
  it('upgrades existing decisions without losing their content or inventing zero token usage', () => {
    const db = track(
      new TelemetryDatabase(':memory:', { migrations: TELEMETRY_MIGRATIONS.slice(0, 1) }),
    );
    db.initialize();
    db.db.exec(
      "INSERT INTO decisions (id, point, questions_json, answers_json, duration_ms, created_at) VALUES ('old', 'routing', '{}', '{}', 4, 0)",
    );
    db.migrate(TELEMETRY_MIGRATIONS);
    expect(
      db.db.prepare('SELECT id, point, input_tokens, output_tokens FROM decisions').get(),
    ).toMatchObject({
      id: 'old',
      point: 'routing',
      input_tokens: null,
      output_tokens: null,
    });
  });
  it('creates the full v1 schema in memory', () => {
    const db = track(new TelemetryDatabase(':memory:'));
    db.initialize();

    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        'decisions',
        'events',
        'executions',
        'llm_call_injections',
        'llm_calls',
        'mcp_calls',
        'payloads',
        'schema_migrations',
        'tool_calls',
      ]),
    );
  });

  it('records the applied migration version', () => {
    const db = track(new TelemetryDatabase(':memory:'));
    db.initialize();

    const rows = db.db
      .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
      .all() as unknown as { version: number; name: string }[];

    expect(rows).toHaveLength(2);
    expect(rows[0]?.version).toBe(1);
    expect(rows[0]?.name).toBeTruthy();
  });

  it('is idempotent across initialize calls and across processes', async () => {
    const path = await tempPath();

    const first = track(new TelemetryDatabase(path));
    first.initialize();
    first.initialize();
    first.close();

    const second = track(new TelemetryDatabase(path));
    second.initialize();

    const count = second.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as
      { n: number } | undefined;
    expect(count?.n).toBe(2);
  });

  it('opens file databases in WAL with incremental auto_vacuum', async () => {
    const db = track(new TelemetryDatabase(await tempPath()));
    db.initialize();

    expect(String(pragma(db, 'journal_mode')).toLowerCase()).toBe('wal');
    // 2 = incremental. Only settable before the first table exists, which is
    // what lets the retention purge hand space back without a full VACUUM.
    expect(pragma(db, 'auto_vacuum')).toBe(2);
  });

  it('creates the indexes the dashboard queries depend on', () => {
    const db = track(new TelemetryDatabase(':memory:'));
    db.initialize();

    const rows = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all() as unknown as { name: string }[];
    const names = rows.map((row) => row.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'idx_executions_thread',
        'idx_llm_calls_trace',
        'idx_tool_calls_trace',
        'idx_mcp_calls_trace',
        'idx_decisions_trace',
      ]),
    );
  });

  it('applies a failing migration atomically, leaving no partial state', () => {
    const broken: TelemetryMigration[] = [
      { version: 1, name: 'ok', up: ['CREATE TABLE a (id TEXT PRIMARY KEY)'] },
      {
        version: 2,
        name: 'broken',
        up: ['CREATE TABLE b (id TEXT PRIMARY KEY)', 'THIS IS NOT SQL'],
      },
    ];

    const db = new TelemetryDatabase(':memory:', { migrations: broken });
    expect(() => db.initialize()).toThrow();

    // The connection is closed on failure, so nothing is left half-migrated.
    expect(() => db.db).toThrow();
  });

  it('resumes from the last applied version', () => {
    const first: TelemetryMigration[] = [
      { version: 1, name: 'one', up: ['CREATE TABLE a (id TEXT PRIMARY KEY)'] },
    ];
    const both: TelemetryMigration[] = [
      ...first,
      { version: 2, name: 'two', up: ['CREATE TABLE b (id TEXT PRIMARY KEY)'] },
    ];

    const db = track(new TelemetryDatabase(':memory:', { migrations: first }));
    db.initialize();
    expect(tableNames(db)).toContain('a');
    expect(tableNames(db)).not.toContain('b');

    db.migrate(both);
    expect(tableNames(db)).toContain('b');

    const versions = db.db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as unknown as { version: number }[];
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
  });

  it('rolls back through the shared transaction helper', () => {
    const db = track(new TelemetryDatabase(':memory:'));
    db.initialize();

    expect(() =>
      db.transaction(() => {
        db.db.exec(
          "INSERT INTO payloads (id, size_bytes, preview, redacted, body, created_at) VALUES ('p1', 1, 'x', 1, 'x', 0)",
        );
        throw new Error('boom');
      }),
    ).toThrow('boom');

    const count = db.db.prepare('SELECT COUNT(*) AS n FROM payloads').get() as
      { n: number } | undefined;
    expect(count?.n).toBe(0);
  });
});
