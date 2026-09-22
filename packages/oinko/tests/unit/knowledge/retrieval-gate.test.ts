import { describe, it, expect, vi } from 'vitest';
import { shouldRetrieveKnowledge } from '../../../src/knowledge/retrieval-gate.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';
import type { Logger } from '../../../src/utils/logger.js';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function createDecider(needsKnowledge: boolean, confidence = 0.9): Decider {
  return {
    decide: vi.fn().mockResolvedValue({ needsKnowledge: { value: needsKnowledge, confidence } }),
  };
}

describe('shouldRetrieveKnowledge', () => {
  it('always retrieves when no decider is configured', async () => {
    expect(await shouldRetrieveKnowledge('ok, obrigado', {})).toBe(true);
  });

  it('skips retrieval when the decider is confident the turn needs no lookup', async () => {
    const decider = createDecider(false, 0.95);
    expect(await shouldRetrieveKnowledge('ok, obrigado', {}, decider)).toBe(false);
  });

  it('retrieves when the decider says the turn needs a lookup', async () => {
    const decider = createDecider(true, 0.9);
    expect(await shouldRetrieveKnowledge('qual a politica de reembolso?', {}, decider)).toBe(true);
  });

  it('retrieves on a low-confidence negative — missing context costs more than a lookup', async () => {
    const decider = createDecider(false, 0.4);
    expect(await shouldRetrieveKnowledge('e sobre aquilo?', {}, decider)).toBe(true);
  });

  it('honours a configured confidence floor', async () => {
    const decider = createDecider(false, 0.55);
    expect(await shouldRetrieveKnowledge('oi', { minConfidence: 0.5 }, decider)).toBe(false);
  });

  it('asks a single bool question about the user input', async () => {
    const decider = createDecider(true);
    await shouldRetrieveKnowledge('qual o preco do plano pro?', {}, decider);

    const [state, questions] = (decider.decide as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(state).toBe('qual o preco do plano pro?');
    expect(Object.keys(questions)).toEqual(['needsKnowledge']);
    expect(questions.needsKnowledge.kind).toBe('bool');
  });

  it('retrieves when the decider throws', async () => {
    const decider = {
      decide: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as Decider;
    const logger = createLogger();

    expect(await shouldRetrieveKnowledge('qualquer coisa', {}, decider, { logger })).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });
});
