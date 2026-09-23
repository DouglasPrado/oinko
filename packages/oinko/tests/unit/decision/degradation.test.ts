import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from '../../../src/agent.js';
import { JevDecider } from '../../../src/decision/jev-decider.js';

/**
 * A real JevDecider pointed at a port nothing listens on — the shape of a
 * missing token, an expired key or an outage. Every gate must degrade to the
 * behaviour it had before the decider existed.
 */
function deadDecider(): JevDecider {
  return new JevDecider({
    apiKey: 'not-a-real-key',
    baseUrl: 'http://127.0.0.1:1/v1',
    timeout: 250,
    maxRetries: 0,
  });
}

function mockLLM(): { models: () => string[]; extractionRan: () => boolean } {
  const models: string[] = [];
  let extractionRan = false;

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const urlStr = typeof url === 'string' ? url : url.toString();

    // Let real calls to the dead decider through — that is the point.
    if (urlStr.includes('127.0.0.1:1')) {
      return globalThis.fetch(url, init);
    }

    if (urlStr.includes('/embeddings')) {
      return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 });
    }

    if (typeof init?.body === 'string') {
      const body = JSON.parse(init.body) as { model?: string };
      if (body.model) models.push(body.model);
      if (init.body.includes('memory extraction subagent')) extractionRan = true;
    }

    const sse =
      'data: {"choices":[{"delta":{"content":"tudo certo"},"index":0}]}\n\n' +
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

  return { models: () => models, extractionRan: () => extractionRan };
}

describe('a decider with no working token', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('still answers the user', async () => {
    mockLLM();
    const dir = await mkdtemp(join(tmpdir(), 'degrade-'));
    const agent = Agent.create({
      apiKey: 'test-key',
      decider: deadDecider(),
      memory: { enabled: true, memoryDir: dir + '/' },
      knowledge: { enabled: false },
    });

    const reply = await agent.chat('qual a politica de reembolso?');

    expect(reply).toBe('tudo certo');
    await agent.destroy();
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps the capable model when routing cannot be decided', async () => {
    const { models } = mockLLM();
    const agent = Agent.create({
      apiKey: 'test-key',
      model: 'anthropic/claude-sonnet-4',
      decider: deadDecider(),
      routing: { fastModel: 'openai/gpt-4o-mini' },
      memory: { enabled: false },
      knowledge: { enabled: false },
    });

    await agent.chat('ok, obrigado');

    expect(models()[0]).toBe('anthropic/claude-sonnet-4');
    await agent.destroy();
  });

  it('falls back to the sampling heuristic for memory extraction', async () => {
    const { extractionRan } = mockLLM();
    const dir = await mkdtemp(join(tmpdir(), 'degrade-mem-'));
    const agent = Agent.create({
      apiKey: 'test-key',
      decider: deadDecider(),
      // The heuristic would always fire — proving the fallback path ran.
      memory: { enabled: true, samplingRate: 1, extractionInterval: 1, memoryDir: dir + '/' },
      knowledge: { enabled: false },
    });

    await agent.chat('eu moro em Sao Paulo');
    await vi.waitFor(() => expect(extractionRan()).toBe(true), { timeout: 3000 });

    await agent.destroy();
    await rm(dir, { recursive: true, force: true });
  });

  it('still retrieves knowledge when the gate cannot be decided', async () => {
    mockLLM();
    const dir = await mkdtemp(join(tmpdir(), 'degrade-rag-'));
    const agent = Agent.create({
      apiKey: 'test-key',
      decider: deadDecider(),
      memory: { enabled: false },
      knowledge: { enabled: true },
      dbPath: join(dir, 'test.db'),
    });

    const reply = await agent.chat('qual a politica?');

    expect(reply).toBe('tudo certo');
    await agent.destroy();
    await rm(dir, { recursive: true, force: true });
  });
});
