import { describe, it, expect, vi } from 'vitest';
import {
  RecordingDecider,
  inferDecisionPoint,
  type DecisionRecord,
} from '../../../src/decision/recording-decider.js';
import type { Decider, Question } from '../../../src/contracts/entities/decider.js';

function createInner(answers: Record<string, { value: unknown; confidence: number }>): Decider {
  return { decide: vi.fn().mockResolvedValue(answers) };
}

function collect(): { sink: (r: DecisionRecord) => void; rows: DecisionRecord[] } {
  const rows: DecisionRecord[] = [];
  return { sink: (r) => rows.push(r), rows };
}

const DURABLE: Record<string, Question> = {
  durable: { kind: 'bool', instructions: 'has a durable fact' },
};

describe('inferDecisionPoint', () => {
  it.each([
    [{ durable: {} }, 'memory_extraction'],
    [{ needsKnowledge: {} }, 'knowledge_gate'],
    [{ skill: {} }, 'skill_activation'],
    [{ kind: {} }, 'tool_error'],
    [{ tier: {} }, 'model_routing'],
    [{ m0: {}, m1: {} }, 'memory_relevance'],
    [{ c0: {}, c1: {} }, 'knowledge_rerank'],
    [{ whatever: {} }, 'unknown'],
  ])('maps %o to %s', (questions, expected) => {
    expect(inferDecisionPoint(questions as Record<string, Question>)).toBe(expected);
  });
});

describe('RecordingDecider', () => {
  it('returns the inner answers untouched', async () => {
    const inner = createInner({ durable: { value: true, confidence: 0.9 } });
    const { sink } = collect();
    const decider = new RecordingDecider(inner, sink);

    const answers = await decider.decide('state', DURABLE);

    expect(answers).toEqual({ durable: { value: true, confidence: 0.9 } });
  });

  it('records the point, answers and elapsed time', async () => {
    const inner = createInner({ durable: { value: true, confidence: 0.9 } });
    const { sink, rows } = collect();

    await new RecordingDecider(inner, sink).decide('state', DURABLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.point).toBe('memory_extraction');
    expect(rows[0]!.answers.durable).toEqual({ value: true, confidence: 0.9 });
    expect(rows[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(rows[0]!.id).toBeTruthy();
  });

  it('hashes the state by default — no user content on disk', async () => {
    const inner = createInner({ durable: { value: true, confidence: 0.9 } });
    const { sink, rows } = collect();

    await new RecordingDecider(inner, sink).decide('meu CNPJ e 12.345.678/0001-90', DURABLE);

    expect(rows[0]!.state).toBeUndefined();
    expect(rows[0]!.stateHash).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(rows[0])).not.toContain('CNPJ');
  });

  it('gives the same hash to the same state', async () => {
    const inner = createInner({ durable: { value: true, confidence: 0.9 } });
    const { sink, rows } = collect();
    const decider = new RecordingDecider(inner, sink);

    await decider.decide('same text', DURABLE);
    await decider.decide('same text', DURABLE);

    expect(rows[0]!.stateHash).toBe(rows[1]!.stateHash);
  });

  it('keeps the raw state only when explicitly asked', async () => {
    const inner = createInner({ durable: { value: true, confidence: 0.9 } });
    const { sink, rows } = collect();
    const decider = new RecordingDecider(inner, sink, { stateMode: 'full' });

    await decider.decide('hello there', DURABLE);

    expect(rows[0]!.state).toBe('hello there');
  });

  it('omits the state entirely on request', async () => {
    const inner = createInner({ durable: { value: true, confidence: 0.9 } });
    const { sink, rows } = collect();

    await new RecordingDecider(inner, sink, { stateMode: 'omit' }).decide('hello', DURABLE);

    expect(rows[0]!.state).toBeUndefined();
    expect(rows[0]!.stateHash).toBeUndefined();
  });

  it('records a failure and rethrows it', async () => {
    const inner = {
      decide: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as Decider;
    const { sink, rows } = collect();

    await expect(new RecordingDecider(inner, sink).decide('s', DURABLE)).rejects.toThrow(
      'network down',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.error).toContain('network down');
  });

  it('never lets a broken sink break the decision', async () => {
    const inner = createInner({ durable: { value: true, confidence: 0.9 } });
    const decider = new RecordingDecider(inner, () => {
      throw new Error('disk full');
    });

    await expect(decider.decide('s', DURABLE)).resolves.toBeTruthy();
  });
});
