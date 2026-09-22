/**
 * LLM-powered relevance selection for file-based memories.
 *
 * Given a user query and a manifest of available memory files, asks the LLM
 * to select up to 5 most relevant memories. Uses LLMClient.chat().
 */

import type { LLMClient } from '../llm/llm-client.js';
import type { Logger } from '../utils/logger.js';
import type { Decider, Question } from '../contracts/entities/decider.js';
import type { MemoryFile, MemoryHeader } from './memory-types.js';

const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful to an AI agent as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a JSON object with a "selected_memories" array containing filenames for the memories that will clearly be useful (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful, do not include it.
- If no memories would clearly be useful, return an empty array.
- Return ONLY valid JSON, no other text.`;

/**
 * Ask the LLM to select relevant memories from a manifest.
 * Returns an array of filenames (up to 5) that are most relevant to the query.
 */
export async function selectRelevantMemories(
  query: string,
  manifest: string,
  validFilenames: Set<string>,
  client: LLMClient,
  options?: { model?: string; signal?: AbortSignal; logger?: Logger },
): Promise<string[]> {
  if (!manifest.trim()) return [];

  try {
    const response = await client.chat({
      model: options?.model,
      messages: [
        { role: 'system', content: SELECT_MEMORIES_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Query: ${query}\n\nAvailable memories:\n${manifest}`,
        },
      ],
      temperature: 0,
      maxTokens: 256,
      responseFormat: { type: 'json_object' },
      signal: options?.signal,
    });

    const parsed = JSON.parse(response.content) as { selected_memories?: string[] };
    if (!Array.isArray(parsed.selected_memories)) return [];

    return parsed.selected_memories
      .filter((f) => typeof f === 'string' && validFilenames.has(f))
      .slice(0, 5);
  } catch (e) {
    options?.logger?.debug('Memory relevance selection failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/** Same ceiling the LLM selector uses. */
const MAX_SELECTED = 5;

/**
 * Ceiling on candidates per request — a manifest of hundreds would make one
 * oversized call. The most recently touched memories are kept.
 */
const MAX_CANDIDATES = 50;

/**
 * Select relevant memories with a decider instead of a full LLM call.
 *
 * Asks one yes/no question per candidate, all in a single round trip, and
 * keeps the most confident positives. Unlike the LLM selector this cannot
 * hallucinate a filename — every answer maps back to a candidate we sent.
 *
 * Throws when the decider is unreachable, so the caller can fall back to
 * `selectRelevantMemories`.
 */
export async function selectRelevantMemoriesWithDecider(
  query: string,
  candidates: readonly MemoryHeader[],
  decider: Decider,
  options?: { signal?: AbortSignal; logger?: Logger },
): Promise<string[]> {
  if (candidates.length === 0) return [];

  const shortlist = [...candidates].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_CANDIDATES);

  // Positional keys: a filename is not a safe object key to round-trip.
  const byKey = new Map<string, string>();
  const questions: Record<string, Question> = {};

  shortlist.forEach((memory, index) => {
    const key = `m${index}`;
    byKey.set(key, memory.filename);
    const description = memory.description ? `: ${memory.description}` : '';
    questions[key] = {
      kind: 'bool',
      instructions: `Memory "${memory.filename}"${description} — this memory is clearly useful for answering the query.`,
      criteria: {
        true: 'The memory carries context that changes or improves the answer.',
        false: 'Unrelated to the query, or adds nothing to the answer.',
      },
    };
  });

  const answers = await decider.decide(query, questions, options?.signal);

  const selected = Object.entries(answers)
    .filter(([, answer]) => answer.value === true)
    .sort((a, b) => b[1].confidence - a[1].confidence)
    .map(([key]) => byKey.get(key))
    .filter((filename): filename is string => filename !== undefined)
    .slice(0, MAX_SELECTED);

  options?.logger?.debug('Memory relevance decided', {
    candidates: shortlist.length,
    selected: selected.length,
  });

  return selected;
}

/**
 * Local, deterministic affinity between a memory and a query.
 *
 * Used by `Agent.recall()` to order what a scope can see without spending a
 * model call. It is a ranking signal, not a filter: a score of zero still
 * leaves the memory in the list, because "no word in common" is not the same
 * as "not relevant" — that judgement is the context pipeline's job.
 */
export function scoreMemoryAgainstQuery(memory: MemoryFile, query: string): number {
  const haystack = [memory.name ?? '', memory.description ?? '', memory.content]
    .join(' ')
    .toLowerCase();

  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 3);

  if (terms.length === 0) return 0;

  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 1;
      continue;
    }
    // Same root, different ending: "prefere" should answer to "preferencia".
    const root = term.slice(0, 4);
    if (term.length > 4 && haystack.includes(root)) score += 0.5;
  }

  return score / terms.length;
}
