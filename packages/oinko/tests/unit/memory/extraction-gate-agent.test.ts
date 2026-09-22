import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from '../../../src/agent.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';

/** Mocks the LLM and reports whether the extraction prompt was ever sent. */
function mockFetch(): { extractionCalled: () => boolean } {
  let extractionCalled = false;

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('/embeddings')) {
      return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 });
    }

    // The forked extraction subagent identifies itself in its prompt.
    const rawBody = typeof init?.body === 'string' ? init.body : '';
    const isExtraction = rawBody.includes('memory extraction subagent');

    if (isExtraction) {
      extractionCalled = true;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '[]' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }),
        { status: 200 },
      );
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

  return { extractionCalled: () => extractionCalled };
}

function createDecider(verdict: boolean, confidence = 0.9): Decider {
  return {
    decide: vi.fn().mockResolvedValue({
      durableFromUser: { value: verdict, confidence },
      durableFromAssistant: { value: verdict, confidence },
    }),
  };
}

describe('Agent with a decider gating memory extraction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips extraction when the decider sees nothing durable, despite sampling at 100%', async () => {
    const { extractionCalled } = mockFetch();
    const memoryDir = (await mkdtemp(join(tmpdir(), 'gate-skip-'))) + '/';
    const decider = createDecider(false);

    const agent = Agent.create({
      apiKey: 'test-key',
      // Both heuristics would fire on every turn — the decider must override them.
      memory: { enabled: true, samplingRate: 1.0, extractionInterval: 1, memoryDir },
      knowledge: { enabled: false },
      decider,
    });

    await agent.chat('ok, obrigado');
    await new Promise((r) => setTimeout(r, 200));

    expect(decider.decide).toHaveBeenCalledOnce();
    expect(extractionCalled()).toBe(false);

    await agent.destroy();
    await rm(memoryDir, { recursive: true, force: true });
  });

  it('runs extraction when the decider sees a durable fact, despite sampling at 0%', async () => {
    const { extractionCalled } = mockFetch();
    const memoryDir = (await mkdtemp(join(tmpdir(), 'gate-run-'))) + '/';
    const decider = createDecider(true);

    const agent = Agent.create({
      apiKey: 'test-key',
      // Neither heuristic would fire — the decider is the only reason to extract.
      memory: { enabled: true, samplingRate: 0, extractionInterval: 999, memoryDir },
      knowledge: { enabled: false },
      decider,
    });

    await agent.chat('meu CNPJ e 12.345.678/0001-90');
    await vi.waitFor(() => expect(extractionCalled()).toBe(true), { timeout: 2000 });

    await agent.destroy();
    await rm(memoryDir, { recursive: true, force: true });
  });

  it('keeps the sampling heuristic when no decider is configured', async () => {
    const { extractionCalled } = mockFetch();
    const memoryDir = (await mkdtemp(join(tmpdir(), 'gate-none-'))) + '/';

    const agent = Agent.create({
      apiKey: 'test-key',
      memory: { enabled: true, samplingRate: 1.0, extractionInterval: 1, memoryDir },
      knowledge: { enabled: false },
    });

    await agent.chat('ok, obrigado');
    await vi.waitFor(() => expect(extractionCalled()).toBe(true), { timeout: 2000 });

    await agent.destroy();
    await rm(memoryDir, { recursive: true, force: true });
  });
});
