import { describe, it, expect, vi, afterEach } from 'vitest';
import { Agent } from '../../../src/agent.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';

/** Mocks the LLM and records the model of each chat request. */
function mockFetch(): { models: () => string[] } {
  const models: string[] = [];

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('/embeddings')) {
      return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 });
    }

    if (typeof init?.body === 'string') {
      const body = JSON.parse(init.body) as { model?: string };
      if (body.model) models.push(body.model);
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

  return { models: () => models };
}

function createDecider(tier: string): Decider {
  return {
    decide: vi.fn().mockResolvedValue({ tier: { value: tier, confidence: 0.95 } }),
  };
}

const FAST = 'openai/gpt-4o-mini';
const CAPABLE = 'anthropic/claude-sonnet-4';

function createAgent(decider?: Decider, routing = true) {
  return Agent.create({
    apiKey: 'test-key',
    model: CAPABLE,
    memory: { enabled: false },
    knowledge: { enabled: false },
    ...(routing && { routing: { fastModel: FAST } }),
    ...(decider !== undefined && { decider }),
  });
}

describe('Agent routing turns between models', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a trivial turn to the fast model', async () => {
    const { models } = mockFetch();
    const agent = createAgent(createDecider('fast'));

    await agent.chat('ok, obrigado');

    expect(models()[0]).toBe(FAST);
    await agent.destroy();
  });

  it('keeps a demanding turn on the capable model', async () => {
    const { models } = mockFetch();
    const agent = createAgent(createDecider('capable'));

    await agent.chat('quantos pedidos tivemos ontem?');

    expect(models()[0]).toBe(CAPABLE);
    await agent.destroy();
  });

  it('never overrides an explicit per-call model', async () => {
    const { models } = mockFetch();
    const decider = createDecider('fast');
    const agent = createAgent(decider);

    await agent.chat('ok', { model: 'openai/gpt-4.1' });

    expect(models()[0]).toBe('openai/gpt-4.1');
    expect(decider.decide).not.toHaveBeenCalled();
    await agent.destroy();
  });

  it('does not route when routing is not configured', async () => {
    const { models } = mockFetch();
    const decider = createDecider('fast');
    const agent = createAgent(decider, false);

    await agent.chat('ok, obrigado');

    expect(models()[0]).toBe(CAPABLE);
    await agent.destroy();
  });
});
