import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { executeReactLoop, CONTINUE_AFTER_FALLBACK, type LLMCallTelemetry } from '../../../src/core/react-loop.js';
import { ToolExecutor } from '../../../src/tools/tool-executor.js';
import type { LLMClient } from '../../../src/llm/llm-client.js';
import type { StreamChunk, StreamChatParams } from '../../../src/llm/message-types.js';
import type { AgentEvent } from '../../../src/contracts/entities/agent-event.js';
import { OverloadedError } from '../../../src/llm/errors.js';

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    });
  });
const done = (tokens = 10): StreamChunk => ({
  type: 'done',
  finishReason: 'stop',
  usage: { inputTokens: tokens, outputTokens: 1, totalTokens: tokens + 1 },
});

async function run(
  model: (params: StreamChatParams, call: number) => AsyncIterable<StreamChunk>,
  options: { tools?: ToolExecutor; afterMs?: number; maxConsecutiveErrors?: number } = {},
) {
  const calls: StreamChatParams[] = [];
  const records: LLMCallTelemetry[] = [];
  let index = 0;
  const loop = executeReactLoop([{ role: 'user', content: 'oi' }], {
    client: {} as LLMClient,
    toolExecutor: options.tools ?? new ToolExecutor(),
    model: 'fast',
    maxIterations: 5,
    maxConsecutiveErrors: options.maxConsecutiveErrors ?? 2,
    onToolError: 'continue',
    latencyFallback: { to: 'main', afterMs: options.afterMs ?? 60 },
    onLLMCall: (call) => records.push(call),
    deps: {
      callModel: (params) => {
        calls.push(params);
        return model(params, index++);
      },
    },
  });
  const events: AgentEvent[] = [];
  let result = await loop.next();
  while (!result.done) {
    events.push(result.value);
    result = await loop.next();
  }
  const text = events.flatMap((event) => (event.type === 'text_delta' ? [event.content] : [])).join('');
  return { events, terminal: result.value, calls, records, text };
}

describe('fast → main fallback', () => {
  it('switches once after the limit without useful output and records both attempts', async () => {
    const result = await run(async function* (params, call) {
      if (call === 0) {
        await sleep(10_000, params.signal);
        yield { type: 'content', data: 'nunca' };
      }
      yield { type: 'content', data: 'resposta principal' };
      yield done();
    });
    expect(result.calls.map((call) => call.model)).toEqual(['fast', 'main']);
    expect(result.events).toContainEqual({ type: 'model_fallback', from: 'fast', to: 'main', reason: 'latency' });
    expect(result.text).toBe('resposta principal');
    expect(result.records.map((record) => [record.seq, record.model, record.cancelled ?? false])).toEqual([
      [0, 'fast', true],
      [1, 'main', false],
    ]);
    expect(result.terminal.reason).toBe('stop');
  });

  it('does not let heartbeats or empty deltas reset the limit', async () => {
    const result = await run(async function* (params, call) {
      if (call === 0)
        for (let i = 0; i < 100; i++) {
          await sleep(10, params.signal);
          yield { type: 'content', data: '' };
        }
      yield { type: 'content', data: 'ok' };
      yield done();
    });
    expect(result.calls.map((call) => call.model)).toEqual(['fast', 'main']);
  });

  it('keeps the fast model once it delivered useful output in time', async () => {
    const result = await run(async function* (params) {
      yield { type: 'content', data: 'rápido ' };
      await sleep(150, params.signal);
      yield { type: 'content', data: 'e completo' };
      yield done();
    });
    expect(result.calls.map((call) => call.model)).toEqual(['fast']);
    expect(result.text).toBe('rápido e completo');
  });

  it('falls back on provider unavailability (503) as well', async () => {
    const result = await run(async function* (_params, call) {
      if (call === 0) throw new OverloadedError('503');
      yield { type: 'content', data: 'principal' };
      yield done();
    });
    expect(result.events).toContainEqual({ type: 'model_fallback', from: 'fast', to: 'main', reason: 'unavailable' });
    expect(result.text).toBe('principal');
  });

  it('keeps partial text and asks the main model to continue without duplicating it', async () => {
    const result = await run(async function* (_params, call) {
      if (call === 0) {
        yield { type: 'content', data: 'Primeira parte, ' };
        throw new OverloadedError('503 mid-stream');
      }
      yield { type: 'content', data: 'segunda parte.' };
      yield done();
    });
    expect(result.text).toBe('Primeira parte, segunda parte.');
    const final = result.events.find((event) => event.type === 'text_done') as { content: string };
    expect(final.content).toBe('Primeira parte, segunda parte.');
    const sent = JSON.stringify(result.calls[1]!.messages);
    expect(sent).toContain('Primeira parte, ');
    expect(sent).toContain(CONTINUE_AFTER_FALLBACK.slice(0, 40));
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'model_fallback', partial: { text: true, tools: 0 } }));
  });

  it('never runs a started tool twice when the attempt fails after requesting it', async () => {
    const tools = new ToolExecutor();
    const execute = vi.fn(async () => 'feito');
    tools.register({ name: 'write_file', description: 'escreve', parameters: z.object({}), execute, isConcurrencySafe: true });
    const result = await run(
      async function* (_params, call) {
        if (call === 0) {
          yield { type: 'tool_call', id: 'call-1', name: 'write_file', arguments: '{}' };
          throw new OverloadedError('503 after tool');
        }
        yield { type: 'content', data: 'concluído' };
        yield done();
      },
      { tools },
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(result.calls.map((call) => call.model)).toEqual(['fast', 'main']);
    expect(JSON.stringify(result.calls[1]!.messages)).toContain('feito');
    expect(result.text).toBe('concluído');
  });

  it('ignores a late answer from the cancelled attempt', async () => {
    const result = await run(async function* (_params, call) {
      if (call === 0) {
        // Ignores the abort signal and answers late.
        await sleep(200);
        yield { type: 'content', data: 'tardio' };
        yield done();
        return;
      }
      yield { type: 'content', data: 'principal' };
      yield done();
    });
    expect(result.text).toBe('principal');
    expect(result.text).not.toContain('tardio');
  });

  it('switches only once: when both models are unavailable the error is reported', async () => {
    const result = await run(async function* () {
      yield* [];
      throw new OverloadedError('503 everywhere');
    });
    expect(result.events.filter((event) => event.type === 'model_fallback')).toHaveLength(1);
    expect(result.terminal.reason).toBe('error');
    expect(result.calls.map((call) => call.model)).toEqual(['fast', 'main', 'main']);
  });
});

describe('fast → main fallback never widens permissions', () => {
  it('sends the main model exactly the tools the fast one had and keeps a denial denied', async () => {
    const tools = new ToolExecutor();
    const execute = vi.fn(async () => 'apagado');
    tools.register({ name: 'read_file', description: 'lê', parameters: z.object({}), execute: async () => 'conteúdo', isConcurrencySafe: true });
    tools.register({
      name: 'delete_all',
      description: 'apaga tudo',
      parameters: z.object({}),
      execute,
      // A semantic guard that refuses the operation regardless of which model asks.
      validate: async () => 'Operação destrutiva exige autorização explícita.',
    });
    const result = await run(
      async function* (_params, call) {
        if (call === 0) throw new OverloadedError('503');
        if (call === 1) {
          yield { type: 'tool_call', id: 'call-1', name: 'delete_all', arguments: '{}' };
          yield done();
          return;
        }
        yield { type: 'content', data: 'não foi possível apagar' };
        yield done();
      },
      { tools },
    );
    const names = (params: StreamChatParams) => (params.tools ?? []).map((tool) => tool.function.name).sort();
    expect(result.calls.map((call) => call.model)).toEqual(['fast', 'main', 'main']);
    expect(names(result.calls[1]!)).toEqual(names(result.calls[0]!));
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(result.calls[2]!.messages)).toContain('autorização explícita');
  });
});
