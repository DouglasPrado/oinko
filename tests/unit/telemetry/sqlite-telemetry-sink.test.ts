import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TelemetryDatabase } from '../../../src/telemetry/telemetry-database.js';
import { SqliteTelemetrySink } from '../../../src/telemetry/sqlite-telemetry-sink.js';
import type {
  TelemetryExecutionStart,
  TelemetryLLMCall,
} from '../../../src/contracts/entities/telemetry.js';

let database: TelemetryDatabase;
let sink: SqliteTelemetrySink;

beforeEach(() => {
  database = new TelemetryDatabase(':memory:');
  database.initialize();
  sink = new SqliteTelemetrySink(database, { flushIntervalMs: 0 });
});

afterEach(async () => {
  await sink.close();
  database.close();
});

function row<T>(sql: string, ...params: (string | number)[]): T | undefined {
  return database.db.prepare(sql).get(...params) as T | undefined;
}

const start: TelemetryExecutionStart = {
  kind: 'execution_start',
  traceId: 't1',
  threadId: 'thread-a',
  model: 'anthropic/claude-sonnet-5',
  providerKind: 'openrouter',
  systemPrompt: 'You are helpful.',
  userInput: 'hello',
  startedAt: 1_000,
};

const llmCall: TelemetryLLMCall = {
  kind: 'llm_call',
  id: 'call-1',
  traceId: 't1',
  seq: 0,
  model: 'anthropic/claude-sonnet-5',
  requestBody: '{"messages":[]}',
  responseText: 'hi',
  costStatus: 'confirmed',
  costSource: 'stream_usage',
  usage: { inputTokens: 194, outputTokens: 2, totalTokens: 196 },
  usageDetail: { costUsd: 0.000042, generationId: 'gen-abc' },
  ttftMs: 320,
  durationMs: 1_240,
  streamed: true,
  startedAt: 1_000,
  endedAt: 2_240,
};

describe('SqliteTelemetrySink', () => {
  it('writes an execution and reads its columns back', async () => {
    sink.write(start);
    await sink.flush();

    const saved = row<{ thread_id: string; model: string; status: string }>(
      'SELECT thread_id, model, status FROM executions WHERE trace_id = ?',
      't1',
    );
    expect(saved?.thread_id).toBe('thread-a');
    expect(saved?.status).toBe('running');
  });

  it('closes the execution on execution_end instead of inserting a second row', async () => {
    sink.write(start);
    sink.write({
      kind: 'execution_end',
      traceId: 't1',
      status: 'ok',
      endReason: 'stop',
      assistantText: 'done',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      endedAt: 3_000,
      durationMs: 2_000,
    });
    await sink.flush();

    const count = row<{ n: number }>('SELECT COUNT(*) AS n FROM executions');
    expect(count?.n).toBe(1);

    const saved = row<{ status: string; duration_ms: number; total_tokens: number }>(
      'SELECT status, duration_ms, total_tokens FROM executions WHERE trace_id = ?',
      't1',
    );
    expect(saved?.status).toBe('ok');
    expect(saved?.duration_ms).toBe(2_000);
    expect(saved?.total_tokens).toBe(15);
  });

  it('records real cost without inventing a value when it is missing', async () => {
    sink.write(llmCall);
    sink.write({ ...llmCall, id: 'call-2', seq: 1, costStatus: 'unavailable', usageDetail: {} });
    await sink.flush();

    const confirmed = row<{ cost_usd: number; cost_source: string; ttft_ms: number }>(
      'SELECT cost_usd, cost_source, ttft_ms FROM llm_calls WHERE id = ?',
      'call-1',
    );
    expect(confirmed?.cost_usd).toBeCloseTo(0.000042, 9);
    expect(confirmed?.cost_source).toBe('stream_usage');
    expect(confirmed?.ttft_ms).toBe(320);

    // Never 0: "cost unknown" and "cost nothing" must stay distinguishable.
    const unknown = row<{ cost_usd: number | null; cost_status: string }>(
      'SELECT cost_usd, cost_status FROM llm_calls WHERE id = ?',
      'call-2',
    );
    expect(unknown?.cost_usd).toBeNull();
    expect(unknown?.cost_status).toBe('unavailable');
  });

  it('stores payload bodies once and points the row at them', async () => {
    sink.write(start);
    sink.write(llmCall);
    sink.write({ ...llmCall, id: 'call-2', seq: 1 });
    await sink.flush();

    const saved = row<{ request_payload_id: string }>(
      'SELECT request_payload_id FROM llm_calls WHERE id = ?',
      'call-1',
    );
    expect(saved?.request_payload_id).toBeTruthy();

    const body = row<{ body: string }>(
      'SELECT body FROM payloads WHERE id = ?',
      saved?.request_payload_id ?? '',
    );
    expect(body?.body).toBe('{"messages":[]}');

    // Two calls with the same request body share one payload row.
    const same = row<{ n: number }>(
      'SELECT COUNT(*) AS n FROM payloads WHERE id = ?',
      saved?.request_payload_id ?? '',
    );
    expect(same?.n).toBe(1);
  });

  it('redacts secrets on the way in', async () => {
    sink.write({ ...start, systemPrompt: 'the key is sk-live-0123456789abcdef0123' });
    await sink.flush();

    const saved = row<{ body: string }>(
      `SELECT p.body FROM executions e JOIN payloads p ON p.id = e.system_prompt_payload_id
       WHERE e.trace_id = ?`,
      't1',
    );
    expect(saved?.body).not.toContain('sk-live-0123456789abcdef0123');
  });

  it('records injections including the blocks the budget dropped', async () => {
    sink.write({
      ...start,
      injections: [
        { source: 'memory:relevant', priority: 10, tokens: 120, applied: true },
        { source: 'knowledge', priority: 5, tokens: 900, applied: false },
      ],
    });
    await sink.flush();

    const dropped = row<{ source: string; tokens: number }>(
      'SELECT source, tokens FROM llm_call_injections WHERE trace_id = ? AND applied = 0',
      't1',
    );
    expect(dropped?.source).toBe('knowledge');
    expect(dropped?.tokens).toBe(900);
  });

  it('serialises an Error into readable columns rather than an empty object', async () => {
    const error = new Error('tool blew up');
    sink.write(start);
    sink.write({
      kind: 'execution_end',
      traceId: 't1',
      status: 'error',
      error: { name: error.name, message: error.message, stack: error.stack ?? '' },
      endedAt: 2_000,
      durationMs: 1_000,
    });
    await sink.flush();

    const saved = row<{ error_name: string; error_message: string }>(
      'SELECT error_name, error_message FROM executions WHERE trace_id = ?',
      't1',
    );
    expect(saved?.error_message).toBe('tool blew up');
    expect(saved?.error_name).toBe('Error');
  });

  it('flushes automatically once the buffer fills', async () => {
    const small = new SqliteTelemetrySink(database, { maxBuffer: 2, flushIntervalMs: 0 });
    small.write({ ...start, traceId: 'a' });
    small.write({ ...start, traceId: 'b' });
    await small.flush();

    expect(row<{ n: number }>('SELECT COUNT(*) AS n FROM executions')?.n).toBe(2);
    await small.close();
  });

  describe('never breaks the turn', () => {
    it('drops a malformed record without losing the rest of the batch', async () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      sink.write({ ...start, traceId: 'bad', injections: cyclic as never });
      sink.write({ ...start, traceId: 'good' });

      await expect(sink.flush()).resolves.toBeUndefined();

      expect(
        row<{ n: number }>("SELECT COUNT(*) AS n FROM executions WHERE trace_id = 'good'")?.n,
      ).toBe(1);
      expect(sink.stats().dropped).toBe(1);
    });

    it('counts what it could not write', async () => {
      sink.write({ kind: 'nonsense' } as never);
      await sink.flush();

      expect(sink.stats().dropped).toBeGreaterThan(0);
    });

    it('ignores writes after close', async () => {
      await sink.close();
      sink.write(start);
      await sink.flush();

      expect(row<{ n: number }>('SELECT COUNT(*) AS n FROM executions')?.n).toBe(0);
    });

    it('reports what it wrote', async () => {
      sink.write(start);
      await sink.flush();

      expect(sink.stats().written).toBe(1);
    });
  });

  describe('capturePayloads', () => {
    it("keeps sizes but not bodies on 'hashed'", async () => {
      const hashed = new SqliteTelemetrySink(database, {
        flushIntervalMs: 0,
        capturePayloads: 'hashed',
      });
      hashed.write(start);
      await hashed.flush();

      const saved = row<{ body: string; size_bytes: number }>(
        `SELECT p.body, p.size_bytes FROM executions e
         JOIN payloads p ON p.id = e.system_prompt_payload_id WHERE e.trace_id = ?`,
        't1',
      );
      expect(saved?.body).toBe('');
      expect(saved?.size_bytes).toBe(16);
      await hashed.close();
    });

    it("stores nothing on 'none'", async () => {
      const none = new SqliteTelemetrySink(database, {
        flushIntervalMs: 0,
        capturePayloads: 'none',
      });
      none.write(start);
      await none.flush();

      expect(
        row<{ system_prompt_payload_id: string | null }>(
          'SELECT system_prompt_payload_id FROM executions WHERE trace_id = ?',
          't1',
        )?.system_prompt_payload_id,
      ).toBeNull();
      expect(row<{ n: number }>('SELECT COUNT(*) AS n FROM payloads')?.n).toBe(0);
      await none.close();
    });
  });
});
