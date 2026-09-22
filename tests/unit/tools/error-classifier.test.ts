import { describe, it, expect, vi } from 'vitest';
import { classifyToolError, TOOL_ERROR_KINDS } from '../../../src/tools/error-classifier.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';

function createDecider(kind: string, confidence = 0.9): Decider {
  return {
    decide: vi.fn().mockResolvedValue({ kind: { value: kind, confidence } }),
  };
}

describe('classifyToolError', () => {
  it('classifies a transient failure', async () => {
    const decider = createDecider('transient');
    const kind = await classifyToolError(new Error('ECONNRESET'), 'run_query', decider);
    expect(kind).toBe('transient');
  });

  it('classifies a permanent failure', async () => {
    const decider = createDecider('permanent');
    const kind = await classifyToolError(new Error('record not found'), 'run_query', decider);
    expect(kind).toBe('permanent');
  });

  it('classifies bad arguments', async () => {
    const decider = createDecider('invalid_input');
    const kind = await classifyToolError(
      new Error('column "x" does not exist'),
      'run_query',
      decider,
    );
    expect(kind).toBe('invalid_input');
  });

  it('sends the tool name and the error message as state', async () => {
    const decider = createDecider('transient');
    await classifyToolError(new Error('boom'), 'run_query', decider);

    const [state, questions] = (decider.decide as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(state).toContain('run_query');
    expect(state).toContain('boom');
    expect(questions.kind.kind).toBe('choice');
    expect(Object.keys(questions.kind.criteria).sort()).toEqual([...TOOL_ERROR_KINDS].sort());
  });

  it('treats an unknown verdict as permanent — never retry what we cannot classify', async () => {
    const decider = createDecider('something-else');
    const kind = await classifyToolError(new Error('boom'), 'tool', decider);
    expect(kind).toBe('permanent');
  });

  it('propagates decider failures so the caller can fall back', async () => {
    const decider = {
      decide: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as Decider;

    await expect(classifyToolError(new Error('boom'), 'tool', decider)).rejects.toThrow(
      'network down',
    );
  });
});
