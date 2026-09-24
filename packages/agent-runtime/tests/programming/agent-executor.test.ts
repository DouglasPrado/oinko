import { describe, expect, it } from 'vitest';
import type { AgentEvent, ChatOptions } from '@oinko/core';
import { AgentCycleExecutor, readJournal, type StreamingAgent } from '../../src/programming/index.js';
import { botView, tempRoot, twoBotMatrix } from './helpers.js';
import { check, createService, edit, operator } from './service-helpers.js';

const usage = { inputTokens: 100, outputTokens: 10, totalTokens: 110 };

/** Agent double that replays SDK events and records the options of each cycle. */
class ReplayAgent implements StreamingAgent {
  readonly calls: { input: string; options?: ChatOptions }[] = [];
  constructor(private readonly events: (options?: ChatOptions) => AgentEvent[]) {}
  async *stream(input: string, options?: ChatOptions): AsyncIterable<AgentEvent> {
    this.calls.push({ input, options });
    for (const event of this.events(options)) {
      await Promise.resolve();
      yield event;
    }
  }
}

describe('M07 AgentCycleExecutor maps SDK events to the run journal', () => {
  it('journals routing, both attempts of a latency fallback and pending context preparation', async () => {
    const access = twoBotMatrix();
    access.bots.set('alpha', botView('alpha', { models: { main: 'main-model', fast: 'fast-model', fallbackAfterMs: 15_000 } }));
    const agent = new ReplayAgent(() => [
      { type: 'agent_start', traceId: 'trace-1', threadId: 't', model: 'fast-model' } as AgentEvent,
      { type: 'warning', code: 'context_preparation_pending', message: 'resumo em segundo plano' } as AgentEvent,
      { type: 'model_fallback', from: 'fast-model', to: 'main-model', reason: 'latency', partial: { text: true, tools: 0 } } as AgentEvent,
      { type: 'text_delta', content: 'Corrigi e testei.' } as AgentEvent,
      { type: 'agent_end', traceId: 'trace-1', reason: 'stop', usage, duration: 1200 } as AgentEvent,
    ]);
    const executor = new AgentCycleExecutor(agent);
    const cycle = executor.runCycle.bind(executor);
    const harness = createService(tempRoot(), access, {
      executor: {
        runCycle: async (input) => {
          const outcome = await cycle(input);
          input.context.record(edit('r1'));
          input.context.record(check('r1', 'passed'));
          return { ...outcome, completion: { summary: outcome.summary } };
        },
      },
    });
    const { run } = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'Corrigir bug' });
    await harness.service.idle();
    expect(harness.store.getRun(run.id)?.state).toBe('completed');

    const options = agent.calls[0]!.options!;
    expect(options).toMatchObject({
      threadId: `programming:${run.id}`,
      model: 'main-model',
      maxIterations: 12,
      correlation: { botId: 'alpha', projectId: 'one', runId: run.id, stepId: expect.any(String) },
    });
    const events = readJournal(harness.database, { runId: run.id }).map((event) => event.envelope);
    const byType = (type: string) => events.filter((event) => event.type === type);
    expect(byType('routing_decision')[0]?.payload).toMatchObject({ model: 'fast-model', tier: 'fast' });
    expect(byType('model_attempt_cancelled')[0]).toMatchObject({ status: 'failed', payload: { model: 'fast-model', reason: 'latency' } });
    expect(byType('model_fallback_triggered')[0]?.payload).toMatchObject({
      from: 'fast-model',
      to: 'main-model',
      reason: 'latency',
      partialText: true,
      partialTools: 0,
    });
    expect(byType('context_preparation_pending')).toHaveLength(1);
    expect(byType('model_attempt_finished')[0]).toMatchObject({ status: 'succeeded', payload: { model: 'main-model', result: 'stop' } });
    await harness.close();
  });

  it('throws a non-recoverable error only when the cycle produced no text', async () => {
    const failing = new AgentCycleExecutor(
      new ReplayAgent(() => [{ type: 'error', error: new Error('provedor fora'), recoverable: false } as AgentEvent]),
    );
    const partial = new AgentCycleExecutor(
      new ReplayAgent(() => [
        { type: 'text_delta', content: 'Parte do trabalho feita.' } as AgentEvent,
        { type: 'error', error: new Error('limite'), recoverable: false } as AgentEvent,
      ]),
    );
    const access = twoBotMatrix();
    const outcomes: string[] = [];
    const harness = createService(tempRoot(), access, {
      executor: {
        runCycle: async (input) => {
          outcomes.push((await partial.runCycle(input)).summary);
          await failing.runCycle(input);
          return { summary: 'inalcançável', traceIds: [] };
        },
      },
    });
    const { run } = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x' });
    await harness.service.idle();
    expect(outcomes[0]).toBe('Parte do trabalho feita.');
    expect(harness.store.getRun(run.id)?.state).not.toBe('completed');
    await harness.close();
  });
});
