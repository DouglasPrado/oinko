import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMClient } from '../../../src/llm/llm-client.js';
import type { StreamChunk } from '../../../src/llm/message-types.js';
import { createSSEResponse } from '../../test-helpers.js';

const PARAMS = { messages: [{ role: 'user' as const, content: 'hi' }] };

/** Chunk final do OpenRouter: o usage completo vem sempre, sem parametro. */
const USAGE_WITH_COST = JSON.stringify({
  id: 'gen-abc123',
  provider: 'Anthropic',
  choices: [],
  usage: {
    prompt_tokens: 194,
    completion_tokens: 2,
    total_tokens: 196,
    cost: 0.00042,
    cost_details: { upstream_inference_cost: 0.00039, cache_discount: 0.00001 },
    prompt_tokens_details: { cached_tokens: 128, cache_write_tokens: 64 },
    completion_tokens_details: { reasoning_tokens: 9 },
  },
});

const USAGE_WITHOUT_COST = JSON.stringify({
  choices: [],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

let client: LLMClient;

beforeEach(() => {
  client = new LLMClient({
    apiKey: 'test-key',
    model: 'test/model',
    baseUrl: 'https://openrouter.ai/api/v1',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function collect(): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of client.streamChat(PARAMS)) chunks.push(chunk);
  return chunks;
}

function doneOf(chunks: StreamChunk[]): Extract<StreamChunk, { type: 'done' }> {
  const done = chunks.find((chunk) => chunk.type === 'done');
  if (done?.type !== 'done') throw new Error('no done chunk');
  return done;
}

describe('LLMClient usage detail', () => {
  it('keeps the real cost the provider charged', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSSEResponse([
        'data: {"choices":[{"delta":{"content":"hi"}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        `data: ${USAGE_WITH_COST}`,
        'data: [DONE]',
      ]),
    );

    const done = doneOf(await collect());

    expect(done.usage).toEqual({ inputTokens: 194, outputTokens: 2, totalTokens: 196 });
    expect(done.usageDetail?.costUsd).toBeCloseTo(0.00042, 9);
    expect(done.usageDetail?.upstreamCostUsd).toBeCloseTo(0.00039, 9);
    expect(done.usageDetail?.cacheDiscountUsd).toBeCloseTo(0.00001, 9);
    expect(done.usageDetail?.cachedTokens).toBe(128);
    expect(done.usageDetail?.cacheWriteTokens).toBe(64);
    expect(done.usageDetail?.reasoningTokens).toBe(9);
    expect(done.usageDetail?.providerName).toBe('Anthropic');
  });

  // A missing cost is "unknown", not "free". Defaulting it to 0 would silently
  // report every non-OpenRouter run as costing nothing.
  it('leaves cost undefined when the provider does not report it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSSEResponse([
        'data: {"choices":[{"delta":{"content":"a"},"finish_reason":"stop"}]}',
        `data: ${USAGE_WITHOUT_COST}`,
        'data: [DONE]',
      ]),
    );

    const done = doneOf(await collect());

    expect(done.usage?.totalTokens).toBe(15);
    expect(done.usageDetail?.costUsd).toBeUndefined();
  });

  it('captures the generation id from any chunk, not just the usage one', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSSEResponse([
        'data: {"id":"gen-xyz789","choices":[{"delta":{"content":"a"}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        `data: ${USAGE_WITHOUT_COST}`,
        'data: [DONE]',
      ]),
    );

    // Without the id there is no way to confirm the cost later.
    expect(doneOf(await collect()).usageDetail?.generationId).toBe('gen-xyz789');
  });

  it('reports the finish reason the provider sent natively', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSSEResponse([
        'data: {"choices":[{"delta":{"content":"a"},"finish_reason":"stop","native_finish_reason":"end_turn"}]}',
        'data: [DONE]',
      ]),
    );

    const done = doneOf(await collect());
    expect(done.finishReason).toBe('stop');
    expect(done.usageDetail?.nativeFinishReason).toBe('end_turn');
  });

  describe('timings', () => {
    it('measures time to first token separately from total duration', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        createSSEResponse([
          'data: {"choices":[{"delta":{"content":"a"}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
          `data: ${USAGE_WITHOUT_COST}`,
          'data: [DONE]',
        ]),
      );

      const done = doneOf(await collect());

      expect(done.ttftMs).toBeGreaterThanOrEqual(0);
      expect(done.durationMs).toBeGreaterThanOrEqual(done.ttftMs ?? 0);
      expect(done.attempts).toBe(1);
    });

    it('charges a retried request to queue time, not to time to first token', async () => {
      const rateLimited = new Response('slow down', { status: 429 });
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(rateLimited)
        .mockResolvedValue(
          createSSEResponse([
            'data: {"choices":[{"delta":{"content":"a"},"finish_reason":"stop"}]}',
            'data: [DONE]',
          ]),
        );

      const done = doneOf(await collect());

      // The retry backoff is at least a second; TTFT must not absorb it.
      expect(done.queuedMs ?? 0).toBeGreaterThan(500);
      expect(done.ttftMs ?? 0).toBeLessThan(500);
      expect(done.attempts).toBe(2);
    });
  });
});
