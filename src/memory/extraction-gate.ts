import type { Decider } from '../contracts/entities/decider.js';
import type { Logger } from '../utils/logger.js';
import { hasExplicitTrigger, shouldExtract } from './memory-extractor.js';

/**
 * The single question that replaces random sampling.
 *
 * Without a decider the harness decides whether a turn is worth remembering
 * with `Math.random() < samplingRate` — a coin flip that drops most facts the
 * user states in passing. A System One question costs little enough to ask on
 * every turn, so the expensive LLM extractor only runs when there is
 * something to extract.
 */
export const DURABLE_FACT_QUESTION = {
  kind: 'bool',
  instructions:
    'The user stated a durable fact, preference, identifier or constraint that is worth remembering in future conversations.',
  criteria: {
    true: 'States something lasting about the user, their work or how they want to be helped.',
    false: 'Small talk, acknowledgements, or a one-off request with nothing durable in it.',
  },
} as const;

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
  turnsSinceExtraction: number,
  config: ExtractionGateConfig,
  decider?: Decider,
  deps?: ExtractionGateDeps,
): Promise<boolean> {
  // Explicit triggers are free and deterministic — never spend a decision on them.
  if (hasExplicitTrigger(lastMessage)) return true;

  if (!decider) return shouldExtract(lastMessage, turnsSinceExtraction, config);

  try {
    const answers = await decider.decide(
      lastMessage,
      { durable: DURABLE_FACT_QUESTION },
      deps?.signal,
    );
    const { value, confidence } = answers.durable;
    return value && confidence >= (config.minConfidence ?? DEFAULT_MIN_CONFIDENCE);
  } catch (error) {
    deps?.logger?.warn('Decider unavailable — falling back to sampling heuristic', {
      error: String(error),
    });
    return shouldExtract(lastMessage, turnsSinceExtraction, config);
  }
}
