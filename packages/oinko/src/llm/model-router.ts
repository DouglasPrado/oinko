import type { Decider } from '../contracts/entities/decider.js';
import type { Logger } from '../utils/logger.js';

/** The two tiers a turn can be routed to. */
export const ROUTE_TIERS = ['fast', 'capable'] as const;

const CRITERIA: Record<(typeof ROUTE_TIERS)[number], string> = {
  fast: 'Greeting, thanks, acknowledgement, small talk, or a short question answerable from the conversation itself.',
  capable: 'Needs tools, data lookup, multi-step reasoning, code, analysis, or careful writing.',
};

const DEFAULT_MIN_CONFIDENCE = 0.7;

export interface ModelRouteOptions {
  /** Model used for everything that is not confidently trivial. */
  capableModel: string;
  /** Cheaper model for trivial turns. */
  fastModel: string;
  /** Confidence required to downgrade to the fast model. Default 0.7. */
  minConfidence?: number;
}

/**
 * Pick which model should answer this turn.
 *
 * Biased towards the capable model: downgrading a turn that needed reasoning
 * produces a visibly worse answer, while keeping a trivial turn on the big
 * model only costs money. So the fast model is chosen solely on a confident
 * verdict — an unsure or unreachable decider stays on the capable one.
 */
export async function routeModel(
  userInput: string,
  options: ModelRouteOptions,
  decider: Decider,
  deps?: { signal?: AbortSignal; logger?: Logger },
): Promise<string> {
  try {
    const answers = await decider.decide(
      userInput,
      {
        tier: {
          kind: 'choice',
          instructions: 'Which model tier should handle this message?',
          criteria: CRITERIA,
        },
      },
      deps?.signal,
    );

    const { value, confidence } = answers.tier;
    if (value === 'fast' && confidence >= (options.minConfidence ?? DEFAULT_MIN_CONFIDENCE)) {
      deps?.logger?.debug('Routed turn to the fast model', { model: options.fastModel });
      return options.fastModel;
    }
    return options.capableModel;
  } catch (error) {
    deps?.logger?.warn('Decider unavailable — staying on the capable model', {
      error: String(error),
    });
    return options.capableModel;
  }
}
