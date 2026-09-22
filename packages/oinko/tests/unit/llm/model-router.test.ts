import { describe, it, expect, vi } from 'vitest';
import { routeModel, ROUTE_TIERS } from '../../../src/llm/model-router.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';
import type { Logger } from '../../../src/utils/logger.js';

function createDecider(tier: string, confidence = 0.9): Decider {
  return {
    decide: vi.fn().mockResolvedValue({ tier: { value: tier, confidence } }),
  };
}

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

const MODELS = { capableModel: 'anthropic/claude-sonnet-4', fastModel: 'openai/gpt-4o-mini' };

describe('routeModel', () => {
  it('routes small talk to the fast model', async () => {
    const model = await routeModel('ok, obrigado', MODELS, createDecider('fast'));
    expect(model).toBe(MODELS.fastModel);
  });

  it('routes work that needs tools or reasoning to the capable model', async () => {
    const model = await routeModel('quantos pedidos ontem?', MODELS, createDecider('capable'));
    expect(model).toBe(MODELS.capableModel);
  });

  it('stays on the capable model when confidence is low', async () => {
    const model = await routeModel('hmm', MODELS, createDecider('fast', 0.4));
    expect(model).toBe(MODELS.capableModel);
  });

  it('honours a configured confidence floor', async () => {
    const model = await routeModel(
      'oi',
      { ...MODELS, minConfidence: 0.5 },
      createDecider('fast', 0.6),
    );
    expect(model).toBe(MODELS.fastModel);
  });

  it('asks a single choice question with both tiers', async () => {
    const decider = createDecider('fast');
    await routeModel('oi', MODELS, decider);

    expect(decider.decide).toHaveBeenCalledOnce();
    const [state, questions] = (decider.decide as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(state).toBe('oi');
    expect(questions.tier.kind).toBe('choice');
    expect(Object.keys(questions.tier.criteria).sort()).toEqual([...ROUTE_TIERS].sort());
  });

  it('stays on the capable model when the decider fails', async () => {
    const decider = {
      decide: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as Decider;
    const logger = createLogger();

    const model = await routeModel('oi', MODELS, decider, { logger });

    expect(model).toBe(MODELS.capableModel);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('stays on the capable model for an unknown verdict', async () => {
    const model = await routeModel('oi', MODELS, createDecider('something-else'));
    expect(model).toBe(MODELS.capableModel);
  });
});
