import { describe, it, expect, vi } from 'vitest';
import { isLoopProductive, PROGRESS_QUESTION } from '../../../src/core/progress-gate.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';
import type { LLMMessage } from '../../../src/llm/message-types.js';
import type { Logger } from '../../../src/utils/logger.js';

function createDecider(progressing: boolean, confidence = 0.9): Decider {
  return {
    decide: vi.fn().mockResolvedValue({ progressing: { value: progressing, confidence } }),
  };
}

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

const SPINNING: LLMMessage[] = [
  { role: 'assistant', content: 'Vou verificar o status.' },
  { role: 'tool', content: 'error: not found', tool_call_id: '1' },
  { role: 'assistant', content: 'Vou verificar o status.' },
  { role: 'tool', content: 'error: not found', tool_call_id: '2' },
];

describe('isLoopProductive', () => {
  it('lets a productive loop continue', async () => {
    expect(await isLoopProductive(SPINNING, 10, createDecider(true))).toBe(true);
  });

  it('reports a loop that is going in circles', async () => {
    expect(await isLoopProductive(SPINNING, 10, createDecider(false))).toBe(false);
  });

  /**
   * Cutting a turn that was actually working is the expensive mistake: the
   * user loses an answer already paid for. An unsure verdict continues.
   */
  it('continues on a low-confidence verdict', async () => {
    expect(await isLoopProductive(SPINNING, 10, createDecider(false, 0.5))).toBe(true);
  });

  it('honours a configured confidence floor', async () => {
    expect(
      await isLoopProductive(SPINNING, 10, createDecider(false, 0.75), { minConfidence: 0.7 }),
    ).toBe(false);
  });

  it('asks a single bool question about the recent turns', async () => {
    const decider = createDecider(true);
    await isLoopProductive(SPINNING, 10, decider);

    const [state, questions] = (decider.decide as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(state).toContain('not found');
    expect(Object.keys(questions)).toEqual(['progressing']);
    expect(questions.progressing).toEqual(PROGRESS_QUESTION);
  });

  it('continues without asking when there is nothing to judge', async () => {
    const decider = createDecider(false);

    expect(await isLoopProductive([], 10, decider)).toBe(true);
    expect(decider.decide).not.toHaveBeenCalled();
  });

  it('continues when the decider fails', async () => {
    const decider = {
      decide: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as Decider;
    const logger = createLogger();

    expect(await isLoopProductive(SPINNING, 10, decider, { logger })).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('sends only the tail of a long transcript', async () => {
    const decider = createDecider(true);
    const long: LLMMessage[] = Array.from({ length: 50 }, (_, i) => ({
      role: 'assistant' as const,
      content: `mensagem ${i}`,
    }));

    await isLoopProductive(long, 10, decider);

    const [state] = (decider.decide as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(state).toContain('mensagem 49');
    expect(state).not.toContain('mensagem 10');
  });
});

describe('PROGRESS_QUESTION', () => {
  /**
   * Um teste de unidade nao alcanca o julgamento — quem responde e um modelo.
   * O que ele guarda e a clausula, porque ela e o conserto de um caso real:
   * duas chamadas identicas a `jobs_wait` (que se limita a 15s) faziam o juiz
   * ver laco e cortar o turno com a imagem ainda renderizando.
   *
   * Medido contra o JEV real com a cauda daquele turno: sem a clausula,
   * progressing=false a 0.90/0.91 — para; com ela, progressing=true — segue.
   * O caso que o gate existe para pegar (a mesma chamada falhando tres vezes)
   * continuou em progressing=false a 0.97 com os dois criterios.
   */
  it('trata espera por trabalho em andamento como progresso', () => {
    expect(PROGRESS_QUESTION.criteria.true).toMatch(/still running/);
    expect(PROGRESS_QUESTION.criteria.false).toMatch(/still running/);
  });
});
