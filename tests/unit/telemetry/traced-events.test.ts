import { describe, it, expect, vi, afterEach } from 'vitest';
import { Agent } from '../../../src/agent.js';
import type { AgentEvent } from '../../../src/contracts/entities/agent-event.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AgentEvent traceId', () => {
  it('carries a traceId on every event, not only on start and end', () => {
    const events: AgentEvent[] = [
      { type: 'text_delta', content: 'hi', traceId: 't1' },
      { type: 'turn_start', iteration: 0, traceId: 't1' },
      { type: 'warning', message: 'slow', code: 'cost_warning', traceId: 't1' },
      { type: 'compaction', strategy: 'microcompact', tokensFreed: 10, traceId: 't1' },
    ];

    expect(events.every((event) => event.traceId === 't1')).toBe(true);
  });

  it('still narrows by type after the intersection', () => {
    const event: AgentEvent = {
      type: 'agent_end',
      traceId: 't1',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      reason: 'stop',
      duration: 5,
    };

    // The compiler must still reach `usage` through the discriminant; a broken
    // intersection would collapse the union and lose this.
    if (event.type === 'agent_end') {
      expect(event.usage.totalTokens).toBe(2);
      expect(event.reason).toBe('stop');
    }
  });

  it('keeps traceId required where it always existed', () => {
    const start: AgentEvent = {
      type: 'agent_start',
      traceId: 't1',
      threadId: 'thread-a',
      model: 'test/model',
    };

    if (start.type === 'agent_start') {
      // Not `string | undefined`: agent_start declared it required, and the
      // intersection must not weaken that.
      const id: string = start.traceId;
      expect(id).toBe('t1');
    }
  });

  it('accepts an event built without a traceId, so existing producers compile', () => {
    const event: AgentEvent = { type: 'text_done', content: 'done' };
    expect(event.traceId).toBeUndefined();
  });
});

describe('Agent.stream correlation', () => {
  it('stamps the same traceId on every event of a turn', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n' +
      'data: [DONE]\n\n';

    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(sse));
              controller.close();
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );

    const agent = Agent.create({
      apiKey: 'test-key',
      memory: { enabled: false },
      knowledge: { enabled: false },
    });

    const events: AgentEvent[] = [];
    for await (const event of agent.stream('Hi')) events.push(event);
    agent.destroy();

    expect(events.length).toBeGreaterThan(2);

    // Every event, not just start and end: without this the timeline cannot be
    // rebuilt from the event stream at all.
    const missing = events.filter((event) => event.traceId === undefined);
    expect(missing).toEqual([]);

    const ids = new Set(events.map((event) => event.traceId));
    expect(ids.size).toBe(1);
  });
});
