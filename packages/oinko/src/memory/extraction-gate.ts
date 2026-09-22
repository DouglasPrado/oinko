import type { Decider } from '../contracts/entities/decider.js';
import type { Logger } from '../utils/logger.js';
import { hasExplicitTrigger, shouldExtract } from './memory-extractor.js';

/**
 * The questions that replace random sampling.
 *
 * Without a decider the harness decides whether a turn is worth remembering
 * with `Math.random() < samplingRate` — a coin flip that drops most facts
 * stated in passing. A System One question costs little enough to ask on every
 * turn, so the expensive LLM extractor only runs when there is something to
 * extract.
 *
 * Both sides of the turn are asked about, in one round trip. A durable fact
 * often shows up only in the reply — a diagnosis the agent reached, a value it
 * computed, a conclusion it drew — and asking about the user's message alone
 * would throw all of that away.
 */
export const DURABLE_FACT_QUESTIONS = {
  durableFromUser: {
    kind: 'bool',
    instructions:
      'The USER message states a durable fact, preference, identifier or constraint worth remembering in future conversations.',
    criteria: {
      true: 'States something lasting about the user, their work or how they want to be helped.',
      false: 'Small talk, acknowledgement, or a one-off request with nothing durable in it.',
    },
  },
  durableFromAssistant: {
    kind: 'bool',
    instructions:
      'The ASSISTANT reply establishes a durable fact worth remembering — a diagnosis, a resolved cause, a computed value, a decision reached or a conclusion about the user system.',
    criteria: {
      true: 'Adds lasting knowledge that would save work if recalled in a future conversation.',
      false:
        'Pleasantry, a restatement of what the user just said, or an answer only useful right now.',
    },
  },
} as const;

/** Keeps a single oversized turn from becoming an oversized request. */
const MAX_SIDE_CHARS = 2_000;

function truncate(text: string): string {
  return text.length > MAX_SIDE_CHARS ? `${text.slice(0, MAX_SIDE_CHARS)}…` : text;
}

/** Confidence floor for accepting a positive verdict. */
const DEFAULT_MIN_CONFIDENCE = 0.7;

export interface ExtractionGateConfig {
  samplingRate?: number;
  extractionInterval?: number;
  /** Minimum confidence required to accept a positive verdict. Default 0.7. */
  minConfidence?: number;
}

export interface ExtractionGateDeps {
  signal?: AbortSignal;
  logger?: Logger;
}

/**
 * Decides whether the current turn should trigger memory extraction.
 *
 * Falls back to the sampling heuristic whenever no decider is configured or
 * the decider is unreachable — the gate never blocks a turn on an external
 * service.
 */
export async function shouldExtractWithDecider(
  lastMessage: string,
  assistantReply: string,
  turnsSinceExtraction: number,
  config: ExtractionGateConfig,
  decider?: Decider,
  deps?: ExtractionGateDeps,
): Promise<boolean> {
  // An explicit trigger is the user asking to be remembered — free, and only
  // ever found on their side of the turn.
  if (hasExplicitTrigger(lastMessage)) return true;

  if (!decider) return shouldExtract(lastMessage, turnsSinceExtraction, config);

  try {
    const turn = `user: ${truncate(lastMessage)}\n\nassistant: ${truncate(assistantReply)}`;
    const answers = await decider.decide(turn, DURABLE_FACT_QUESTIONS, deps?.signal);

    const floor = config.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    // Either side carrying something durable is reason enough to extract.
    return [answers.durableFromUser, answers.durableFromAssistant].some(
      (answer) => answer.value && answer.confidence >= floor,
    );
  } catch (error) {
    deps?.logger?.warn('Decider unavailable — falling back to sampling heuristic', {
      error: String(error),
    });
    return shouldExtract(lastMessage, turnsSinceExtraction, config);
  }
}
