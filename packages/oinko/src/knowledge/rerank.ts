import type { Decider, Question } from '../contracts/entities/decider.js';
import type { RetrievedKnowledge } from '../contracts/entities/knowledge.js';
import type { Logger } from '../utils/logger.js';

/**
 * Ordered relevance levels. The decider returns a probability-weighted
 * position on this scale, so 2.4 sits between "relevant" and "directly
 * answers".
 */
export const RELEVANCE_LEVELS = [
  'unrelated to the query',
  'tangentially related',
  'relevant',
  'directly answers the query',
] as const;

/** Keep anything at least halfway between "tangential" and "relevant". */
const DEFAULT_MIN_RELEVANCE = 1.5;

/** Ceiling on chunks per request — reranking is not a place for huge calls. */
const MAX_RERANK_CANDIDATES = 20;

export interface RerankOptions {
  topK: number;
  /** Minimum position on the relevance scale to keep a chunk. Default 1.5. */
  minRelevance?: number;
  signal?: AbortSignal;
  logger?: Logger;
}

/**
 * Reorders retrieved chunks by judged relevance.
 *
 * Vector search ranks by cosine similarity, which measures resemblance to the
 * query, not usefulness in answering it. This asks the decider to place each
 * chunk on an ordered scale and keeps the best ones.
 *
 * The similarity `score` is left untouched — the judged position is recorded
 * in `metadata.rerankScore`, so nothing downstream misreads one for the other.
 *
 * Throws when the decider is unreachable, so the caller can fall back to the
 * similarity order.
 */
export async function rerankChunks(
  query: string,
  candidates: readonly RetrievedKnowledge[],
  decider: Decider,
  options: RerankOptions,
): Promise<RetrievedKnowledge[]> {
  if (candidates.length === 0) return [];

  const shortlist = candidates.slice(0, MAX_RERANK_CANDIDATES);

  const byKey = new Map<string, RetrievedKnowledge>();
  const questions: Record<string, Question> = {};

  shortlist.forEach((candidate, index) => {
    const key = `c${index}`;
    byKey.set(key, candidate);
    questions[key] = {
      kind: 'score',
      instructions: `How useful is this passage for answering the query?\n\n${candidate.content}`,
      criteria: RELEVANCE_LEVELS,
    };
  });

  const answers = await decider.decide(query, questions, options.signal);
  const floor = options.minRelevance ?? DEFAULT_MIN_RELEVANCE;

  const ranked = Object.entries(answers)
    // Every question sent was a score, so every answer is numeric; anything
    // else is a malformed response and drops out at the floor check below.
    .map(([key, answer]) => ({
      candidate: byKey.get(key),
      relevance: typeof answer.value === 'number' ? answer.value : Number.NaN,
    }))
    .filter(
      (entry): entry is { candidate: RetrievedKnowledge; relevance: number } =>
        entry.candidate !== undefined && entry.relevance >= floor,
    )
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, options.topK)
    .map(({ candidate, relevance }) => ({
      ...candidate,
      metadata: { ...candidate.metadata, rerankScore: relevance },
    }));

  options.logger?.debug('Knowledge rerank applied', {
    candidates: shortlist.length,
    kept: ranked.length,
  });

  return ranked;
}
