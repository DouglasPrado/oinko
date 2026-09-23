import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from '../../../src/agent.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';

/** Mocks the LLM and counts embedding round trips. */
function mockFetch(): { embeddingCalls: () => number } {
  let embeddingCalls = 0;

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const urlStr = typeof url === 'string' ? url : url.toString();

    if (urlStr.includes('/embeddings')) {
      embeddingCalls++;
      return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 });
    }

    const sse =
      'data: {"choices":[{"delta":{"content":"ok"},"index":0}]}\n\n' +
      'data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n';

    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sse));
          controller.close();
        },
      }),
      { status: 200 },
    );
  });

  return { embeddingCalls: () => embeddingCalls };
}

function createDecider(needsKnowledge: boolean): Decider {
  return {
    decide: vi
      .fn()
      .mockResolvedValue({ needsKnowledge: { value: needsKnowledge, confidence: 0.95 } }),
  };
}

async function createAgent(decider?: Decider) {
  const dir = await mkdtemp(join(tmpdir(), 'rag-gate-'));
  const agent = Agent.create({
    apiKey: 'test-key',
    memory: { enabled: false },
    knowledge: { enabled: true },
    dbPath: join(dir, 'test.db'),
    ...(decider !== undefined && { decider }),
  });
  return { agent, dir };
}

describe('Agent with a decider gating knowledge retrieval', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips the embedding round trip when the turn needs no lookup', async () => {
    const { embeddingCalls } = mockFetch();
    const decider = createDecider(false);
    const { agent, dir } = await createAgent(decider);

    await agent.chat('ok, obrigado');

    expect(decider.decide).toHaveBeenCalledOnce();
    expect(embeddingCalls()).toBe(0);

    await agent.destroy();
    await rm(dir, { recursive: true, force: true });
  });

  it('retrieves when the decider says the turn needs a lookup', async () => {
    const { embeddingCalls } = mockFetch();
    const { agent, dir } = await createAgent(createDecider(true));

    await agent.chat('qual a politica de reembolso?');

    expect(embeddingCalls()).toBeGreaterThan(0);

    await agent.destroy();
    await rm(dir, { recursive: true, force: true });
  });

  it('retrieves on every turn when no decider is configured', async () => {
    const { embeddingCalls } = mockFetch();
    const { agent, dir } = await createAgent();

    await agent.chat('ok, obrigado');

    expect(embeddingCalls()).toBeGreaterThan(0);

    await agent.destroy();
    await rm(dir, { recursive: true, force: true });
  });
});
