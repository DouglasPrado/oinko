import { describe, it, expect, vi } from 'vitest';
import { KnowledgeManager } from '../../../src/knowledge/knowledge-manager.js';
import type { EmbeddingService } from '../../../src/knowledge/embedding-service.js';
import type { VectorStore } from '../../../src/contracts/entities/stores.js';
import type { RetrievedKnowledge } from '../../../src/contracts/entities/knowledge.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';

function createStore(results: RetrievedKnowledge[]): VectorStore {
  return {
    upsert: vi.fn(),
    search: vi.fn().mockReturnValue(results),
    delete: vi.fn(),
    listAll: vi.fn().mockReturnValue([]),
    deleteBySource: vi.fn(),
  };
}

function createEmbeddings(): EmbeddingService {
  return {
    embedSingle: vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2])),
  } as unknown as EmbeddingService;
}

function chunk(id: string, content: string, score: number): RetrievedKnowledge {
  return { id, content, score };
}

describe('KnowledgeManager with a reranking decider', () => {
  it('pulls a wider candidate pool when a decider is configured', async () => {
    const store = createStore([chunk('1', 'alpha', 0.9)]);
    const decider = {
      decide: vi.fn().mockResolvedValue({ c0: { value: 3, confidence: 0.9 } }),
    } as unknown as Decider;

    const manager = new KnowledgeManager({
      store,
      embeddingService: createEmbeddings(),
      topK: 5,
      decider,
    });

    await manager.search('query', 'escopo-de-teste');

    // topK 5 × multiplier 3
    expect((store.search as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toBe(15);
  });

  it('pulls exactly topK without a decider', async () => {
    const store = createStore([chunk('1', 'alpha', 0.9)]);
    const manager = new KnowledgeManager({
      store,
      embeddingService: createEmbeddings(),
      topK: 5,
    });

    await manager.search('query', 'escopo-de-teste');

    expect((store.search as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toBe(5);
  });

  it('returns chunks in judged-relevance order, not similarity order', async () => {
    const store = createStore([
      chunk('1', 'alpha', 0.95),
      chunk('2', 'beta', 0.9),
      chunk('3', 'gamma', 0.85),
    ]);
    const decider = {
      decide: vi.fn().mockResolvedValue({
        c0: { value: 1.6, confidence: 0.9 },
        c1: { value: 3, confidence: 0.9 },
        c2: { value: 2.2, confidence: 0.9 },
      }),
    } as unknown as Decider;

    const manager = new KnowledgeManager({
      store,
      embeddingService: createEmbeddings(),
      topK: 3,
      decider,
    });

    const results = await manager.search('query', 'escopo-de-teste');

    expect(results.map((r) => r.id)).toEqual(['2', '3', '1']);
  });

  it('keeps the similarity order when the rerank fails', async () => {
    const store = createStore([
      chunk('1', 'alpha', 0.95),
      chunk('2', 'beta', 0.9),
      chunk('3', 'gamma', 0.85),
    ]);
    const decider = {
      decide: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as Decider;

    const manager = new KnowledgeManager({
      store,
      embeddingService: createEmbeddings(),
      topK: 2,
      decider,
    });

    const results = await manager.search('query', 'escopo-de-teste');

    expect(results.map((r) => r.id)).toEqual(['1', '2']);
  });
});
