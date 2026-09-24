import { join } from 'node:path';
import { TelemetryDatabase } from '@oinko/core';
import { describe, expect, it } from 'vitest';
import { UsageLedger, readJournal, unionLength } from '../../src/programming/index.js';
import { botView, makeRun, openStore, twoBotMatrix } from './helpers.js';

function setup() {
  let clock = 10_000;
  const access = twoBotMatrix();
  access.bots.set('alpha', botView('alpha', { models: { main: 'main-model', fast: 'fast-model', fallbackAfterMs: 15_000 } }));
  const context = openStore(undefined, () => clock);
  const run = context.store.insertRun(makeRun(access, 'alpha', 'two'), 'h').run;
  const ledger = new UsageLedger(context.store, context.journal, () => clock);
  return { ...context, run, ledger, tick: (ms: number) => (clock += ms) };
}

describe('UsageLedger', () => {
  it('sums by call id so redelivered reports never double tokens or cost', () => {
    const { ledger, run } = setup();
    const call = { callId: 'c1', role: 'main' as const, model: 'main-model', inputTokens: 100, outputTokens: 20, totalTokens: 120, costUsd: 0.002, costStatus: 'confirmed' as const, startedAt: 1, endedAt: 2 };
    expect(ledger.report(run, call)).toBe('recorded');
    expect(ledger.report(run, call)).toBe('unchanged');
    expect(ledger.metrics(run.id)).toMatchObject({ calls: 1, tokens: { total: 120 }, cost: { confirmedUsd: 0.002, coverage: 1, totalUsd: 0.002 } });
  });

  it('never shows unknown cost as zero and reports coverage', () => {
    const { ledger, run } = setup();
    ledger.report(run, { callId: 'a', role: 'main', model: 'm', totalTokens: 10, costUsd: 0.01, costStatus: 'confirmed', startedAt: 1 });
    ledger.report(run, { callId: 'b', role: 'jev', model: 'jev', totalTokens: 5, costStatus: 'unavailable', startedAt: 1 });
    ledger.report(run, { callId: 'c', role: 'summary', model: 'm', totalTokens: 7, costStatus: 'pending', startedAt: 1 });
    const metrics = ledger.metrics(run.id);
    expect(metrics.cost).toMatchObject({ confirmedUsd: 0.01, pendingCalls: 1, unavailableCalls: 1, coverage: 1 / 3 });
    expect(metrics.cost.totalUsd).toBeUndefined();
    expect(metrics.tokens.byRole).toEqual({ main: 10, jev: 5, summary: 7 });
  });

  it('reconciles late usage and confirmed cost once, and counts aborted attempts that reported usage', () => {
    const { ledger, run, database } = setup();
    ledger.report(run, { callId: 'late', role: 'fast', model: 'fast-model', costStatus: 'pending', aborted: true, startedAt: 1 });
    expect(ledger.report(run, { callId: 'late', role: 'fast', model: 'fast-model', totalTokens: 40, costUsd: 0.0004, costStatus: 'confirmed', startedAt: 1 })).toBe('reconciled');
    expect(ledger.report(run, { callId: 'late', role: 'fast', model: 'fast-model', totalTokens: 40, costStatus: 'pending', startedAt: 1 })).toBe('unchanged');
    expect(ledger.metrics(run.id)).toMatchObject({ abortedCalls: 1, tokens: { total: 40 }, cost: { confirmedUsd: 0.0004 } });
    expect(readJournal(database, { type: 'usage_reconciled' })).toHaveLength(1);
  });

  it('measures total time as a union of overlapping spans and separates phases', () => {
    const { ledger, run } = setup();
    ledger.recordInterval(run.id, 'queue', 0, 100);
    ledger.recordInterval(run.id, 'model', 100, 400);
    ledger.recordInterval(run.id, 'tool', 300, 500); // parallel with the model stream
    ledger.recordInterval(run.id, 'total', 100, 400);
    ledger.recordInterval(run.id, 'total', 300, 500);
    expect(ledger.metrics(run.id).durations).toMatchObject({ queue: 100, model: 300, tool: 200, total: 400 });
    expect(unionLength([[0, 10], [5, 15], [20, 30]])).toBe(25);
  });

  it('matches a synthetic invoice when aggregated by bot, model and policy', () => {
    const { ledger, run } = setup();
    const invoice = [
      { callId: 'i1', model: 'main-model', costUsd: 0.1, totalTokens: 1000 },
      { callId: 'i2', model: 'main-model', costUsd: 0.2, totalTokens: 2000 },
      { callId: 'i3', model: 'fast-model', costUsd: 0.05, totalTokens: 500 },
    ];
    for (const line of invoice)
      ledger.report(run, { ...line, role: line.model === 'fast-model' ? 'fast' : 'main', costStatus: 'confirmed', startedAt: 1 });
    const byModel = ledger.aggregate('model');
    expect(byModel['main-model']?.cost.confirmedUsd).toBeCloseTo(0.3);
    expect(byModel['fast-model']?.tokens.total).toBe(500);
    expect(ledger.aggregate('bot_id').alpha?.cost.totalUsd).toBeCloseTo(0.35);
    expect(Object.keys(ledger.aggregate('policy_version'))).toEqual([run.policySnapshot.version]);
  });

  it('collects main, fast, summary and Jev calls of a run from the SDK telemetry database', () => {
    const { ledger, run, dir } = setup();
    const path = join(dir, 'telemetry.db');
    const telemetry = new TelemetryDatabase(path);
    telemetry.initialize();
    const insert = telemetry.db.prepare(
      `INSERT INTO llm_calls (id, trace_id, seq, model, input_tokens, output_tokens, total_tokens, cost_usd, cost_status, attempts, cancelled, started_at, ended_at)
       VALUES (?, 't1', ?, ?, 10, 2, 12, ?, ?, 1, ?, 1, 2)`,
    );
    insert.run('t1:0', 0, 'fast-model', 0.001, 'confirmed', 1);
    insert.run('t1:1', 1, 'main-model', null, 'pending', 0);
    insert.run('t1:summary:0', 2, 'main-model', null, 'unavailable', 0);
    telemetry.db
      .prepare(
        "INSERT INTO decisions (id, trace_id, point, questions_json, answers_json, duration_ms, created_at, input_tokens, output_tokens) VALUES ('d1', 't1', 'routing', '{}', '{}', 5, 1, 30, 3)",
      )
      .run();
    telemetry.close();
    expect(ledger.collectFromTelemetry(run, path, ['t1'])).toBe(4);
    expect(ledger.collectFromTelemetry(run, path, ['t1'])).toBe(4); // idempotent re-read
    const metrics = ledger.metrics(run.id);
    expect(metrics.calls).toBe(4);
    expect(metrics.abortedCalls).toBe(1);
    expect(metrics.tokens.byRole).toEqual({ fast: 12, main: 12, summary: 12, jev: 33 });
    expect(metrics.cost).toMatchObject({ confirmedCalls: 1, pendingCalls: 1, unavailableCalls: 2 });
  });
});
