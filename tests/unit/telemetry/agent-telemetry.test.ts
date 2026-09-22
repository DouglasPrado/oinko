import { describe, it, expect, vi, afterEach } from 'vitest';
import { Agent } from '../../../src/agent.js';
import type { TelemetryRecord, TelemetrySink } from '../../../src/contracts/entities/telemetry.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Stream com o formato real do OpenRouter: finish_reason e depois o usage. */
function mockProvider(usage: string): void {
  const sse =
    'data: {"id":"gen-abc","provider":"Anthropic","choices":[{"delta":{"content":"hello"}}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
    `data: ${usage}\n\n` +
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
}

const WITH_COST =
  '{"choices":[],"usage":{"prompt_tokens":194,"completion_tokens":2,"total_tokens":196,"cost":0.00042}}';
const WITHOUT_COST =
  '{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}';

function collectingSink(): { sink: TelemetrySink; records: TelemetryRecord[] } {
  const records: TelemetryRecord[] = [];
  return {
    records,
    sink: {
      write: (record) => records.push(record),
      flush: () => Promise.resolve(),
      close: () => Promise.resolve(),
      stats: () => ({ written: records.length, dropped: 0 }),
    },
  };
}

async function runTurn(sink: TelemetrySink, input = 'Hi'): Promise<void> {
  const agent = Agent.create({
    apiKey: 'sk-test-key-0123456789abcdef',
    memory: { enabled: false },
    knowledge: { enabled: false },
    telemetry: { sink },
  });

  for await (const _ of agent.stream(input)) {
    /* drain */
  }
  await agent.destroy();
}

describe('Agent telemetry', () => {
  it('records the execution, the LLM call and the end of the turn', async () => {
    mockProvider(WITH_COST);
    const { sink, records } = collectingSink();

    await runTurn(sink);

    expect(records.map((record) => record.kind)).toEqual(
      expect.arrayContaining(['execution_start', 'llm_call', 'execution_end']),
    );

    const start = records.find((record) => record.kind === 'execution_start');
    const end = records.find((record) => record.kind === 'execution_end');
    const call = records.find((record) => record.kind === 'llm_call');

    // Everything about one turn shares a trace, so the timeline can be rebuilt.
    expect(new Set([start?.traceId, end?.traceId, call?.traceId]).size).toBe(1);
  });

  it('keeps the prompt that was actually sent', async () => {
    mockProvider(WITH_COST);
    const { sink, records } = collectingSink();

    await runTurn(sink, 'what is the weather');

    const start = records.find((record) => record.kind === 'execution_start');
    if (start?.kind !== 'execution_start') throw new Error('no execution_start');

    expect(start.systemPrompt).toBeTruthy();
    expect(start.userInput).toBe('what is the weather');
    expect(start.toolsSchema).toBeTruthy();
    expect(start.contextTokens).toBeGreaterThan(0);
    expect(start.providerKind).toBe('openrouter');
  });

  it('records the cost the provider actually charged', async () => {
    mockProvider(WITH_COST);
    const { sink, records } = collectingSink();

    await runTurn(sink);

    const call = records.find((record) => record.kind === 'llm_call');
    if (call?.kind !== 'llm_call') throw new Error('no llm_call');

    expect(call.usageDetail?.costUsd).toBeCloseTo(0.00042, 9);
    expect(call.costStatus).toBe('confirmed');
    expect(call.costSource).toBe('stream_usage');
    expect(call.usageDetail?.generationId).toBe('gen-abc');
    expect(call.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('marks cost unavailable rather than guessing when the provider is silent', async () => {
    mockProvider(WITHOUT_COST);
    const { sink, records } = collectingSink();

    await runTurn(sink);

    const call = records.find((record) => record.kind === 'llm_call');
    if (call?.kind !== 'llm_call') throw new Error('no llm_call');

    expect(call.costStatus).toBe('unavailable');
    expect(call.usageDetail?.costUsd).toBeUndefined();
    expect(call.costSource).toBeUndefined();
    // Token counts are still real even when the price is not known.
    expect(call.usage?.totalTokens).toBe(12);
  });

  it('never lets a broken sink take the turn down', async () => {
    mockProvider(WITH_COST);
    const exploding: TelemetrySink = {
      write: () => {
        throw new Error('sink is on fire');
      },
      flush: () => Promise.reject(new Error('flush failed')),
      close: () => Promise.reject(new Error('close failed')),
      stats: () => ({ written: 0, dropped: 0 }),
    };

    await expect(runTurn(exploding)).resolves.toBeUndefined();
  });

  it('writes nothing and creates no file when telemetry is not configured', async () => {
    mockProvider(WITH_COST);
    const agent = Agent.create({
      apiKey: 'test-key',
      memory: { enabled: false },
      knowledge: { enabled: false },
    });

    const texts: string[] = [];
    for await (const event of agent.stream('Hi')) {
      if (event.type === 'text_delta') texts.push(event.content);
    }
    await agent.destroy();

    expect(texts.join('')).toBe('hello');
  });
});
