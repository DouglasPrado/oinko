import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
let path: string;

/** Schema minimo que a dashboard le, semeado em arquivo — read-only e WAL so se manifestam em arquivo. */
function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE executions (
    trace_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, app TEXT, model TEXT NOT NULL,
    requested_model TEXT, provider_kind TEXT NOT NULL, system_prompt_payload_id TEXT,
    tools_schema_payload_id TEXT, tool_def_count INTEGER, user_input_payload_id TEXT,
    assistant_text_payload_id TEXT, context_tokens INTEGER, status TEXT NOT NULL,
    end_reason TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL, cost_status TEXT NOT NULL DEFAULT 'pending',
    llm_call_count INTEGER NOT NULL DEFAULT 0, tool_call_count INTEGER NOT NULL DEFAULT 0,
    error_name TEXT, error_message TEXT, error_stack TEXT, started_at INTEGER NOT NULL,
    ended_at INTEGER, duration_ms INTEGER, ttft_ms INTEGER)`);
  db.exec(
    'CREATE TABLE llm_calls (id TEXT PRIMARY KEY, trace_id TEXT, cost_usd REAL, cost_status TEXT, started_at INTEGER)',
  );
  db.exec('CREATE TABLE tool_calls (id TEXT PRIMARY KEY, trace_id TEXT, started_at INTEGER)');
  db.exec(
    'CREATE TABLE payloads (id TEXT PRIMARY KEY, size_bytes INTEGER, preview TEXT, redacted INTEGER, body TEXT, created_at INTEGER)',
  );
  return db;
}

function insert(
  db: DatabaseSync,
  row: {
    traceId: string;
    model: string;
    startedAt: number;
    costUsd: number | null;
    tokens: number;
  },
): void {
  db.prepare(
    `INSERT INTO executions (trace_id, thread_id, model, provider_kind, status, total_tokens,
       cost_usd, duration_ms, started_at)
     VALUES (?, 'chat-1', ?, 'openrouter', 'ok', ?, ?, 100, ?)`,
  ).run(row.traceId, row.model, row.tokens, row.costUsd, row.startedAt);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thread-repo-'));
  path = join(dir, 'telemetry.db');
  process.env.TELEMETRY_DB_PATH = path;
  // `env` e validado uma vez, na primeira importacao do modulo; sem resetar,
  // todos os testes leriam o banco do primeiro.
  vi.resetModules();
  // O repositorio guarda a conexao em globalThis para sobreviver ao HMR.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('@oinko/dashboard/telemetry-db')];
});

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('@oinko/dashboard/telemetry-db')];
  rmSync(dir, { recursive: true, force: true });
});

async function listThreads() {
  const { listThreads: fn } = await import('@/server/repositories/thread-repository');
  return fn({ q: '', model: '', status: 'all' });
}

describe('listThreads', () => {
  // MAX(model) devolve o maior alfabetico: numa conversa roteada entre
  // gpt-4o-mini e gpt-5.6 ele nomearia gpt-5.6 mesmo que o ultimo turno tenha
  // sido no mini — e a coluna diz "ultimo modelo".
  it('reports the model of the most recent execution, not the alphabetical maximum', async () => {
    const db = createDatabase();
    insert(db, { traceId: 'a', model: 'gpt-5.6', startedAt: 1_000, costUsd: null, tokens: 10 });
    insert(db, { traceId: 'b', model: 'gpt-4o-mini', startedAt: 2_000, costUsd: null, tokens: 20 });
    db.close();

    const [thread] = await listThreads();

    expect(thread?.lastModel).toBe('gpt-4o-mini');
    expect(thread?.modelCount).toBe(2);
  });

  it('leaves unknown cost out of the total and counts it apart', async () => {
    const db = createDatabase();
    insert(db, { traceId: 'a', model: 'm', startedAt: 1_000, costUsd: 0.004, tokens: 10 });
    insert(db, { traceId: 'b', model: 'm', startedAt: 2_000, costUsd: null, tokens: 20 });
    db.close();

    const [thread] = await listThreads();

    // Somar null como zero faria a conversa parecer mais barata do que foi.
    expect(thread?.costUsd).toBeCloseTo(0.004, 9);
    expect(thread?.unknownCostCount).toBe(1);
    expect(thread?.totalTokens).toBe(30);
  });

  it('reports no cost at all when nothing was confirmed', async () => {
    const db = createDatabase();
    insert(db, { traceId: 'a', model: 'm', startedAt: 1_000, costUsd: null, tokens: 10 });
    db.close();

    const [thread] = await listThreads();
    expect(thread?.costUsd).toBeNull();
  });
});
