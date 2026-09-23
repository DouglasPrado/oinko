import { describe, it, expect, vi, afterEach } from 'vitest';
import { Agent } from '../../../src/agent.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';
import type { AgentEvent } from '../../../src/contracts/entities/agent-event.js';

/** Streams a turn that always calls the same tool, so the loop never settles. */
function mockSpinningLLM(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('/embeddings')) {
      return new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), { status: 200 });
    }

    const sse =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"spin","arguments":"{}"}}]},"index":0}]}\n\n' +
      'data: {"choices":[{"finish_reason":"tool_calls","index":0}],"usage":{"prompt_tokens":5,"completion_tokens":5,"total_tokens":10}}\n\n';

    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(sse));
          c.close();
        },
      }),
      { status: 200 },
    );
  });
}

function createDecider(progressing: boolean): Decider {
  return {
    decide: vi.fn().mockImplementation((_s: string, questions: Record<string, unknown>) => {
      // Only answers the progress question; other gates are off in this test.
      if ('progressing' in questions) {
        return Promise.resolve({ progressing: { value: progressing, confidence: 0.95 } });
      }
      return Promise.resolve({});
    }),
  };
}

async function runAgent(decider?: Decider): Promise<AgentEvent[]> {
  const agent = Agent.create({
    apiKey: 'test-key',
    memory: { enabled: false },
    knowledge: { enabled: false },
    maxIterations: 12,
    progressCheckInterval: 2,
    ...(decider !== undefined && { decider }),
  });

  agent.addTool({
    name: 'spin',
    description: 'always returns the same thing',
    parameters: (await import('zod')).z.object({}),
    execute: () => Promise.resolve('error: not found'),
  });

  const events: AgentEvent[] = [];
  for await (const event of agent.stream('faz isso ai', { threadId: 't1' })) events.push(event);
  await agent.destroy();
  return events;
}

describe('Agent stopping a loop that goes in circles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops early and says why when the decider sees no progress', async () => {
    mockSpinningLLM();
    const events = await runAgent(createDecider(false));

    const warning = events.find((e) => e.type === 'warning' && e.code === 'no_progress');
    expect(warning).toBeDefined();

    const turns = events.filter((e) => e.type === 'turn_start').length;
    expect(turns).toBeLessThan(12);
  });

  it('runs to maxIterations when the decider sees progress', async () => {
    mockSpinningLLM();
    const events = await runAgent(createDecider(true));

    expect(events.find((e) => e.type === 'warning' && e.code === 'no_progress')).toBeUndefined();
    expect(events.find((e) => e.type === 'warning' && e.code === 'max_iterations')).toBeDefined();
  });

  it('keeps the old behaviour without a decider', async () => {
    mockSpinningLLM();
    const events = await runAgent();

    expect(events.find((e) => e.type === 'warning' && e.code === 'no_progress')).toBeUndefined();
    expect(events.find((e) => e.type === 'warning' && e.code === 'max_iterations')).toBeDefined();
  });
});
