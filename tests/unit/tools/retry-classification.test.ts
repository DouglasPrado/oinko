import { describe, it, expect, vi } from 'vitest';
import { ToolExecutor } from '../../../src/tools/tool-executor.js';
import type { AgentTool } from '../../../src/contracts/entities/agent-tool.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';
import { z } from 'zod';

function failingTool(attempts: { count: number }): AgentTool {
  return {
    name: 'flaky',
    description: 'fails',
    parameters: z.object({}),
    retryable: true,
    maxRetries: 2,
    execute: vi.fn().mockImplementation(() => {
      attempts.count++;
      return Promise.reject(new Error('record not found'));
    }),
  };
}

function createDecider(kind: string): Decider {
  return {
    decide: vi.fn().mockResolvedValue({ kind: { value: kind, confidence: 0.9 } }),
  };
}

describe('ToolExecutor retry with error classification', () => {
  it('does not retry an error judged permanent', async () => {
    const attempts = { count: 0 };
    const executor = new ToolExecutor({ decider: createDecider('permanent') });
    executor.register(failingTool(attempts));

    const result = await executor.execute('flaky', {});

    expect(result.isError).toBe(true);
    expect(attempts.count).toBe(1);
  });

  it('retries an error judged transient', async () => {
    const attempts = { count: 0 };
    const executor = new ToolExecutor({ decider: createDecider('transient') });
    executor.register(failingTool(attempts));

    await executor.execute('flaky', {});

    expect(attempts.count).toBe(3); // initial + 2 retries
  });

  it('retries blindly when no decider is configured', async () => {
    const attempts = { count: 0 };
    const executor = new ToolExecutor();
    executor.register(failingTool(attempts));

    await executor.execute('flaky', {});

    expect(attempts.count).toBe(3);
  });

  it('retries when the decider itself fails', async () => {
    const attempts = { count: 0 };
    const decider = {
      decide: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as Decider;
    const executor = new ToolExecutor({ decider });
    executor.register(failingTool(attempts));

    await executor.execute('flaky', {});

    expect(attempts.count).toBe(3);
  });

  it('leaves a custom retryable predicate in charge', async () => {
    const attempts = { count: 0 };
    const decider = createDecider('transient');
    const executor = new ToolExecutor({ decider });
    executor.register({
      ...failingTool(attempts),
      retryable: () => false,
    });

    await executor.execute('flaky', {});

    expect(attempts.count).toBe(1);
    expect(decider.decide).not.toHaveBeenCalled();
  });
});
