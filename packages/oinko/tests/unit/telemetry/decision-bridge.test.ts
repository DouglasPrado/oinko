import { describe, it, expect } from 'vitest';
import { traceDecisions } from '../../../src/telemetry/decision-bridge.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';
import type { TelemetryRecord, TelemetrySink } from '../../../src/contracts/entities/telemetry.js';

function collecting(): { sink: TelemetrySink; records: TelemetryRecord[] } {
  const records: TelemetryRecord[] = [];
  return {
    records,
    sink: {
      write: (record) => records.push(record),
      flush: () => Promise.resolve(),
      close: () => Promise.resolve(),
      stats: () => ({ written: records.length, dropped: 0 }),
    },
  };
}

const yes: Decider = {
  decide: () => Promise.resolve({ needsKnowledge: { value: true, confidence: 0.91 } } as never),
};

describe('traceDecisions', () => {
  it('stamps the execution on every decision it records', async () => {
    const { sink, records } = collecting();
    const decider = traceDecisions(yes, sink, { traceId: 't1', threadId: 'thread-a' });

    await decider.decide('estado', {
      needsKnowledge: { kind: 'bool', instructions: 'precisa buscar?' },
    });

    const decision = records.find((record) => record.kind === 'decision');
    if (decision?.kind !== 'decision') throw new Error('nenhuma decisao gravada');

    // Sem o trace, "quais decisoes este turno tomou?" e impossivel de responder.
    expect(decision.traceId).toBe('t1');
    expect(decision.threadId).toBe('thread-a');
    expect(decision.point).toBe('knowledge_gate');
    expect(decision.answers.needsKnowledge?.confidence).toBe(0.91);
    expect(decision.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps the evaluated state as a digest by default', async () => {
    const { sink, records } = collecting();
    const decider = traceDecisions(yes, sink, { traceId: 't1', threadId: 'thread-a' });

    await decider.decide('mensagem privada do usuario', {
      needsKnowledge: { kind: 'bool', instructions: 'x' },
    });

    const decision = records.find((record) => record.kind === 'decision');
    if (decision?.kind !== 'decision') throw new Error('nenhuma decisao gravada');

    // O estado avaliado e o que a pessoa escreveu; o default guarda digest.
    expect(decision.state).toBeUndefined();
    expect(decision.stateHash).toBeTruthy();
  });

  it('stores the state itself only when asked', async () => {
    const { sink, records } = collecting();
    const decider = traceDecisions(yes, sink, { traceId: 't1', threadId: 'a' }, 'full');

    await decider.decide('texto inteiro', { needsKnowledge: { kind: 'bool', instructions: 'x' } });

    const decision = records.find((record) => record.kind === 'decision');
    if (decision?.kind !== 'decision') throw new Error('nenhuma decisao gravada');
    expect(decision.state).toBe('texto inteiro');
  });

  it('returns the inner answer untouched', async () => {
    const { sink } = collecting();
    const decider = traceDecisions(yes, sink, { traceId: 't1', threadId: 'a' });

    const answers = await decider.decide('x', {
      needsKnowledge: { kind: 'bool', instructions: 'x' },
    });

    expect(answers.needsKnowledge.value).toBe(true);
  });

  it('does not let a failing sink break the decision', async () => {
    const exploding: TelemetrySink = {
      write: () => {
        throw new Error('sink quebrado');
      },
      flush: () => Promise.resolve(),
      close: () => Promise.resolve(),
      stats: () => ({ written: 0, dropped: 0 }),
    };
    const decider = traceDecisions(yes, exploding, { traceId: 't1', threadId: 'a' });

    await expect(
      decider.decide('x', { needsKnowledge: { kind: 'bool', instructions: 'x' } }),
    ).resolves.toBeDefined();
  });

  it('records a decision that failed, with the reason', async () => {
    const { sink, records } = collecting();
    const broken: Decider = {
      decide: () => Promise.reject(new Error('jev fora do ar')),
    };
    const decider = traceDecisions(broken, sink, { traceId: 't1', threadId: 'a' });

    await expect(
      decider.decide('x', { needsKnowledge: { kind: 'bool', instructions: 'x' } }),
    ).rejects.toThrow('jev fora do ar');

    const decision = records.find((record) => record.kind === 'decision');
    if (decision?.kind !== 'decision') throw new Error('nenhuma decisao gravada');
    expect(decision.error).toContain('jev fora do ar');
  });
});
