import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelemetryDatabase } from '../../../src/telemetry/telemetry-database.js';
import { CostEnricher } from '../../../src/telemetry/cost-enricher.js';
import { GenerationNotReadyError } from '../../../src/llm/errors.js';
import type { GenerationStats } from '../../../src/llm/llm-client.js';

let database: TelemetryDatabase;

beforeEach(() => {
  database = new TelemetryDatabase(':memory:');
  database.initialize();
});

afterEach(() => {
  database.close();
});

/** Uma execucao com uma chamada pendente de confirmacao de custo. */
function seed(traceId: string, generationId: string | null, startedAt = Date.now()): void {
  database.db
    .prepare(
      `INSERT INTO executions (trace_id, thread_id, model, provider_kind, status, started_at)
       VALUES (?, 'thread', 'm', 'openrouter', 'ok', ?)`,
    )
    .run(traceId, startedAt);
  database.db
    .prepare(
      `INSERT INTO llm_calls (id, trace_id, seq, model, generation_id, cost_status, started_at)
       VALUES (?, ?, 0, 'm', ?, 'pending', ?)`,
    )
    .run(`call-${traceId}`, traceId, generationId, startedAt);
}

function call(traceId: string) {
  return database.db
    .prepare(
      'SELECT cost_usd, cost_status, cost_source, cost_attempts FROM llm_calls WHERE trace_id = ?',
    )
    .get(traceId) as
    | {
        cost_usd: number | null;
        cost_status: string;
        cost_source: string | null;
        cost_attempts: number;
      }
    | undefined;
}

function execution(traceId: string) {
  return database.db
    .prepare('SELECT cost_usd, cost_status FROM executions WHERE trace_id = ?')
    .get(traceId) as { cost_usd: number | null; cost_status: string } | undefined;
}

const stats: GenerationStats = { totalCostUsd: 0.00042, providerName: 'Anthropic' };

function enricher(
  fetchGeneration: (id: string) => Promise<GenerationStats>,
  overrides?: { maxRetries?: number },
): CostEnricher {
  return new CostEnricher(database, fetchGeneration, {
    initialDelay: 0,
    maxRetries: overrides?.maxRetries ?? 2,
  });
}

describe('CostEnricher', () => {
  it('confirms the cost the provider charged', async () => {
    seed('t1', 'gen-abc');
    const enrich = enricher(() => Promise.resolve(stats));

    enrich.enqueue('t1');
    await enrich.drain();

    const saved = call('t1');
    expect(saved?.cost_usd).toBeCloseTo(0.00042, 9);
    expect(saved?.cost_status).toBe('confirmed');
    expect(saved?.cost_source).toBe('generation_api');
  });

  it('rolls the confirmed cost up into the execution', async () => {
    seed('t1', 'gen-abc');
    const enrich = enricher(() => Promise.resolve(stats));

    enrich.enqueue('t1');
    await enrich.drain();

    const saved = execution('t1');
    expect(saved?.cost_usd).toBeCloseTo(0.00042, 9);
    expect(saved?.cost_status).toBe('confirmed');
  });

  // "Ainda nao sei" nao pode virar "nao da para saber": a chamada continua
  // pendente e volta a ser tentada no proximo boot.
  it('keeps the call pending when the cost never became available', async () => {
    seed('t1', 'gen-abc');
    const enrich = enricher(() => Promise.reject(new GenerationNotReadyError('ainda nao')));

    enrich.enqueue('t1');
    await enrich.drain();

    const saved = call('t1');
    expect(saved?.cost_status).toBe('pending');
    expect(saved?.cost_usd).toBeNull();
    expect(saved?.cost_attempts).toBeGreaterThan(0);
  });

  it('never calls the provider for a call without a generation id', async () => {
    seed('t1', null);
    const fetchGeneration = vi.fn(() => Promise.resolve(stats));
    const enrich = enricher(fetchGeneration);

    enrich.enqueue('t1');
    await enrich.drain();

    expect(fetchGeneration).not.toHaveBeenCalled();
    expect(call('t1')?.cost_status).toBe('unavailable');
  });

  it('gives up on a definitive failure instead of retrying forever', async () => {
    seed('t1', 'gen-abc');
    const fetchGeneration = vi.fn(() => Promise.reject(new Error('401 unauthorized')));
    const enrich = enricher(fetchGeneration);

    enrich.enqueue('t1');
    await enrich.drain();

    // Uma tentativa so: insistir num 401 nao muda nada.
    expect(fetchGeneration).toHaveBeenCalledTimes(1);
    expect(call('t1')?.cost_status).toBe('pending');
  });

  // Enriquecer duas vezes precisa dar o mesmo numero: o roll-up e por SUM,
  // nunca acumulado, e a coluna e atribuida, nunca somada.
  it('is idempotent, so a second pass does not double the bill', async () => {
    seed('t1', 'gen-abc');
    const enrich = enricher(() => Promise.resolve(stats));

    enrich.enqueue('t1');
    await enrich.drain();
    enrich.enqueue('t1');
    await enrich.drain();

    expect(execution('t1')?.cost_usd).toBeCloseTo(0.00042, 9);
  });

  it('recovers what was left pending by a previous run', async () => {
    seed('t1', 'gen-a');
    seed('t2', 'gen-b');
    const enrich = enricher(() => Promise.resolve(stats));

    // Um restart nao pode perder custo que ainda nao havia fechado.
    expect(enrich.recoverPending()).toBe(2);
    await enrich.drain();

    expect(call('t1')?.cost_status).toBe('confirmed');
    expect(call('t2')?.cost_status).toBe('confirmed');
  });

  it('leaves alone what is already settled', async () => {
    seed('t1', 'gen-abc');
    database.db
      .prepare(
        "UPDATE llm_calls SET cost_status = 'confirmed', cost_usd = 0.5 WHERE trace_id = 't1'",
      )
      .run();
    const fetchGeneration = vi.fn(() => Promise.resolve(stats));
    const enrich = enricher(fetchGeneration);

    enrich.enqueue('t1');
    await enrich.drain();

    expect(fetchGeneration).not.toHaveBeenCalled();
    expect(call('t1')?.cost_usd).toBe(0.5);
  });
});
