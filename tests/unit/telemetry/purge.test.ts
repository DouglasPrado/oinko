import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TelemetryDatabase } from '../../../src/telemetry/telemetry-database.js';
import { purgeTelemetry } from '../../../src/telemetry/purge.js';

let database: TelemetryDatabase;

const DAY = 86_400_000;
const NOW = 1_000 * DAY;

beforeEach(() => {
  database = new TelemetryDatabase(':memory:');
  database.initialize();
});

afterEach(() => {
  database.close();
});

/** Cria uma execucao completa com todas as filhas, no instante dado. */
function seed(traceId: string, at: number): void {
  const db = database.db;
  db.prepare(
    `INSERT INTO payloads (id, size_bytes, preview, redacted, body, created_at)
     VALUES (?, 1, 'x', 1, 'x', ?)`,
  ).run(`p-${traceId}`, at);
  db.prepare(
    `INSERT INTO executions (trace_id, thread_id, model, provider_kind, status,
       user_input_payload_id, started_at)
     VALUES (?, 'thread', 'm', 'openrouter', 'ok', ?, ?)`,
  ).run(traceId, `p-${traceId}`, at);
  db.prepare(
    `INSERT INTO llm_calls (id, trace_id, seq, model, cost_status, started_at)
     VALUES (?, ?, 0, 'm', 'confirmed', ?)`,
  ).run(`c-${traceId}`, traceId, at);
  db.prepare(
    `INSERT INTO tool_calls (id, trace_id, name, origin, duration_ms, started_at, ended_at)
     VALUES (?, ?, 't', 'builtin', 1, ?, ?)`,
  ).run(`t-${traceId}`, traceId, at, at);
  db.prepare(
    `INSERT INTO mcp_calls (id, trace_id, server_name, remote_tool_name,
       namespaced_tool_name, duration_ms, started_at)
     VALUES (?, ?, 's', 'r', 'n', 1, ?)`,
  ).run(`m-${traceId}`, traceId, at);
  db.prepare(
    `INSERT INTO decisions (id, trace_id, point, questions_json, answers_json,
       duration_ms, created_at)
     VALUES (?, ?, 'p', '{}', '{}', 1, ?)`,
  ).run(`d-${traceId}`, traceId, at);
  db.prepare(
    `INSERT INTO llm_call_injections (id, trace_id, source, priority, tokens, applied, created_at)
     VALUES (?, ?, 'tools', 1, 10, 1, ?)`,
  ).run(`i-${traceId}`, traceId, at);
  db.prepare(
    `INSERT INTO events (trace_id, seq, type, created_at) VALUES (?, 0, 'agent_start', ?)`,
  ).run(traceId, at);
}

function count(table: string): number {
  const row = database.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as
    { n: number } | undefined;
  return row?.n ?? 0;
}

describe('purgeTelemetry', () => {
  it('removes what fell outside the window and keeps the rest', () => {
    seed('old', NOW - 40 * DAY);
    seed('fresh', NOW - 2 * DAY);

    purgeTelemetry(database, { retentionDays: 30, now: NOW });

    const row = database.db.prepare('SELECT trace_id FROM executions').get() as
      { trace_id: string } | undefined;
    expect(row?.trace_id).toBe('fresh');
  });

  it('takes the children with it, leaving no orphan rows', () => {
    seed('old', NOW - 40 * DAY);

    purgeTelemetry(database, { retentionDays: 30, now: NOW });

    for (const table of [
      'executions',
      'llm_calls',
      'tool_calls',
      'mcp_calls',
      'decisions',
      'llm_call_injections',
      'events',
      'payloads',
    ]) {
      expect(count(table), `${table} ficou com linha orfa`).toBe(0);
    }
  });

  it('keeps deleting until nothing old is left, even in small batches', () => {
    for (let index = 0; index < 25; index++) seed(`old-${index}`, NOW - 40 * DAY);

    // Lote pequeno de proposito: o DELETE precisa repetir ate zerar, e nao
    // parar no primeiro lote — e o lote e pequeno justamente para nao segurar
    // o unico slot de writer do WAL.
    const result = purgeTelemetry(database, { retentionDays: 30, now: NOW, batchSize: 4 });

    expect(count('executions')).toBe(0);
    expect(result.deleted.executions).toBe(25);
  });

  it('does nothing when everything is inside the window', () => {
    seed('fresh', NOW - DAY);

    const result = purgeTelemetry(database, { retentionDays: 30, now: NOW });

    expect(count('executions')).toBe(1);
    expect(Object.values(result.deleted).every((n) => n === 0)).toBe(true);
  });

  // Um prompt reusado por meses tem `created_at` renovado a cada escrita, entao
  // so expira quando parar de ser usado. Purgar por idade e seguro por causa
  // disso; sem o touch, apagaria conteudo que execucoes novas ainda apontam.
  it('keeps a payload that was written again recently', () => {
    seed('old', NOW - 40 * DAY);
    database.db.prepare('UPDATE payloads SET created_at = ? WHERE id = ?').run(NOW - DAY, 'p-old');

    purgeTelemetry(database, { retentionDays: 30, now: NOW });

    expect(count('payloads')).toBe(1);
    expect(count('executions')).toBe(0);
  });
});
