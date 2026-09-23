import type { Decider } from '../contracts/entities/decider.js';
import type { Logger } from '../utils/logger.js';

/**
 * Question asked before spending an embedding call on RAG.
 *
 * Without a decider the harness searches the knowledge base on every single
 * turn — including greetings and acknowledgements — which costs an embedding
 * round trip plus a vector scan for messages that could never benefit.
 */
export const KNOWLEDGE_NEEDED_QUESTION = {
  kind: 'bool',
  instructions:
    'Answering this message requires looking up reference material (documentation, policies, product or domain facts) in a knowledge base.',
  criteria: {
    true: 'Asks about facts, documents, policies, products or any domain content that has to be looked up.',
    false:
      'Greeting, acknowledgement, small talk, or a request answerable from the conversation itself.',
  },
} as const;

const DEFAULT_MIN_CONFIDENCE = 0.7;

export interface RetrievalGateConfig {
  /** Confidence required to skip retrieval. Default 0.7. */
  minConfidence?: number;
}

export interface RetrievalGateDeps {
  signal?: AbortSignal;
  logger?: Logger;
}

/**
 * Decides whether this turn should hit the knowledge base.
 *
 * Biased towards retrieving: a false negative silently degrades the answer,
 * while a false positive only costs one lookup. Retrieval is therefore
 * skipped solely on a confident "no" — no decider, an unsure verdict or an
 * unreachable one all fall back to searching, which is today's behaviour.
 */
export async function shouldRetrieveKnowledge(
  userInput: string,
  config: RetrievalGateConfig,
  decider?: Decider,
  deps?: RetrievalGateDeps,
): Promise<boolean> {
  if (!decider) return true;

  try {
    const answers = await decider.decide(
      userInput,
      { needsKnowledge: KNOWLEDGE_NEEDED_QUESTION },
      deps?.signal,
    );
    const { value, confidence } = answers.needsKnowledge;
    if (!value && confidence >= (config.minConfidence ?? DEFAULT_MIN_CONFIDENCE)) return false;
    return true;
  } catch (error) {
    deps?.logger?.warn('Decider unavailable — retrieving knowledge anyway', {
      error: String(error),
    });
    return true;
  }
}
