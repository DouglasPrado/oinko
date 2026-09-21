import { describe, it, expect, vi } from 'vitest';
import { ShadowDecider, type ShadowRecord } from '../../../src/decision/shadow-decider.js';
import type { Decider, Question } from '../../../src/contracts/entities/decider.js';

function createDecider(value: unknown, confidence = 0.9): Decider {
  return {
    decide: vi.fn().mockResolvedValue({ durable: { value, confidence } }),
  };
}

function collect(): { sink: (r: ShadowRecord) => void; rows: ShadowRecord[] } {
  const rows: ShadowRecord[] = [];
  return { sink: (r) => rows.push(r), rows };
}

const QUESTIONS: Record<string, Question> = {
  durable: { kind: 'bool', instructions: 'has a durable fact' },
};

describe('ShadowDecider', () => {
  it('returns the primary answers', async () => {
    const { sink } = collect();
    const decider = new ShadowDecider(createDecider(true), createDecider(false), sink);

    const answers = await decider.decide('s', QUESTIONS);

    expect(answers.durable.value).toBe(true);
  });

  it('consults both deciders', async () => {
    const primary = createDecider(true);
    const shadow = createDecider(true);
    const { sink } = collect();

    await new ShadowDecider(primary, shadow, sink).decide('s', QUESTIONS);

    expect(primary.decide).toHaveBeenCalledOnce();
    expect(shadow.decide).toHaveBeenCalledOnce();
  });

  it('records agreement', async () => {
    const { sink, rows } = collect();
    await new ShadowDecider(createDecider(true), createDecider(true), sink).decide('s', QUESTIONS);

    expect(rows[0]!.agreed).toBe(true);
    expect(rows[0]!.point).toBe('memory_extraction');
  });

  it('records disagreement with both verdicts', async () => {
    const { sink, rows } = collect();
    await new ShadowDecider(createDecider(true, 0.9), createDecider(false, 0.8), sink).decide(
      's',
      QUESTIONS,
    );

    expect(rows[0]!.agreed).toBe(false);
    expect(rows[0]!.primary.durable!.value).toBe(true);
    expect(rows[0]!.shadow?.durable!.value).toBe(false);
  });

  it('records both latencies', async () => {
    const { sink, rows } = collect();
    await new ShadowDecider(createDecider(true), createDecider(true), sink).decide('s', QUESTIONS);

    expect(rows[0]!.primaryMs).toBeGreaterThanOrEqual(0);
    expect(rows[0]!.shadowMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps working when the shadow fails', async () => {
    const shadow = {
      decide: vi.fn().mockRejectedValue(new Error('shadow down')),
    } as unknown as Decider;
    const { sink, rows } = collect();

    const answers = await new ShadowDecider(createDecider(true), shadow, sink).decide(
      's',
      QUESTIONS,
    );

    expect(answers.durable.value).toBe(true);
    expect(rows[0]!.shadowError).toContain('shadow down');
    expect(rows[0]!.agreed).toBeUndefined();
  });

  it('propagates a primary failure', async () => {
    const primary = {
      decide: vi.fn().mockRejectedValue(new Error('primary down')),
    } as unknown as Decider;
    const { sink, rows } = collect();

    await expect(
      new ShadowDecider(primary, createDecider(true), sink).decide('s', QUESTIONS),
    ).rejects.toThrow('primary down');
    expect(rows[0]!.primaryError).toContain('primary down');
  });

  it('never lets a broken sink break the decision', async () => {
    const decider = new ShadowDecider(createDecider(true), createDecider(true), () => {
      throw new Error('disk full');
    });

    await expect(decider.decide('s', QUESTIONS)).resolves.toBeTruthy();
  });
});
