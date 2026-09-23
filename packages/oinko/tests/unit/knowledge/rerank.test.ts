import { describe, it, expect, vi } from 'vitest';
import { rerankChunks, RELEVANCE_LEVELS } from '../../../src/knowledge/rerank.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';
import type { RetrievedKnowledge } from '../../../src/contracts/entities/knowledge.js';

function chunk(id: string, content: string, score = 0.5): RetrievedKnowledge {
  return { id, content, score };
}

/** Scores each chunk by looking its content up in the map. */
function createDecider(scores: Record<string, number>): Decider {
  return {
    decide: vi
      .fn()
      .mockImplementation((_state: string, questions: Record<string, { instructions: string }>) => {
        const answers: Record<string, { value: number; confidence: number }> = {};
        for (const [key, question] of Object.entries(questions)) {
          const match = Object.keys(scores).find((c) => question.instructions.includes(c));
          answers[key] = { value: match ? scores[match]! : 0, confidence: 0.9 };
        }
        return Promise.resolve(answers);
      }),
  };
}

describe('rerankChunks', () => {
  it('orders chunks by judged relevance, not by embedding similarity', async () => {
    const candidates = [
      chunk('1', 'alpha', 0.9),
      chunk('2', 'beta', 0.8),
      chunk('3', 'gamma', 0.7),
    ];
    const decider = createDecider({ alpha: 1.6, beta: 3, gamma: 2.2 });

    const result = await rerankChunks('q', candidates, decider, { topK: 3 });

    expect(result.map((r) => r.id)).toEqual(['2', '3', '1']);
  });

  it('drops chunks below the relevance floor', async () => {
    const candidates = [chunk('1', 'alpha'), chunk('2', 'beta')];
    const decider = createDecider({ alpha: 0.2, beta: 2.5 });

    const result = await rerankChunks('q', candidates, decider, { topK: 5 });

    expect(result.map((r) => r.id)).toEqual(['2']);
  });

  it('honours a configured relevance floor', async () => {
    const candidates = [chunk('1', 'alpha'), chunk('2', 'beta')];
    const decider = createDecider({ alpha: 0.8, beta: 2.5 });

    const result = await rerankChunks('q', candidates, decider, { topK: 5, minRelevance: 0.5 });

    expect(result).toHaveLength(2);
  });

  it('caps the result at topK', async () => {
    const candidates = Array.from({ length: 9 }, (_, i) => chunk(String(i), `c${i}`));
    const scores = Object.fromEntries(candidates.map((c, i) => [`c${i}`, 2 + i / 10]));

    const result = await rerankChunks('q', candidates, createDecider(scores), { topK: 4 });

    expect(result).toHaveLength(4);
  });

  it('asks one score question per chunk in a single round trip', async () => {
    const candidates = [chunk('1', 'alpha'), chunk('2', 'beta')];
    const decider = createDecider({});

    await rerankChunks('what is alpha?', candidates, decider, { topK: 5 });

    expect(decider.decide).toHaveBeenCalledOnce();
    const [state, questions] = (decider.decide as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(state).toBe('what is alpha?');
    expect(Object.keys(questions)).toHaveLength(2);
    const first = Object.values(questions)[0] as { kind: string; criteria: readonly string[] };
    expect(first.kind).toBe('score');
    expect(first.criteria).toEqual(RELEVANCE_LEVELS);
  });

  it('records the judged relevance in metadata without touching the similarity score', async () => {
    const candidates = [chunk('1', 'alpha', 0.42)];
    const decider = createDecider({ alpha: 2.5 });

    const [result] = await rerankChunks('q', candidates, decider, { topK: 5 });

    expect(result!.score).toBe(0.42);
    expect(result!.metadata?.rerankScore).toBeCloseTo(2.5);
  });

  it('returns an empty list without calling the decider when there are no candidates', async () => {
    const decider = createDecider({});
    expect(await rerankChunks('q', [], decider, { topK: 5 })).toEqual([]);
    expect(decider.decide).not.toHaveBeenCalled();
  });

  it('propagates decider failures so the caller can fall back', async () => {
    const decider = {
      decide: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as Decider;

    await expect(rerankChunks('q', [chunk('1', 'alpha')], decider, { topK: 5 })).rejects.toThrow(
      'network down',
    );
  });
});
