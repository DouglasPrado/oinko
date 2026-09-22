import type { Decider } from '../contracts/entities/decider.js';
import type { Logger } from '../utils/logger.js';
import type { MemoryHeader } from './memory-types.js';

/** Sentinel meaning no existing memory covers the new one. */
export const NO_DUPLICATE = '__none__';

/**
 * A merge that should not have happened costs a memory; a duplicate that slips
 * through costs a file. So the bar is high.
 */
const DEFAULT_MIN_CONFIDENCE = 0.75;

/** Ceiling on candidates per request — the newest are the likely matches. */
const MAX_CANDIDATES = 40;

export interface NewMemory {
  name: string;
  description: string;
}

export interface DedupOptions {
  minConfidence?: number;
  signal?: AbortSignal;
  logger?: Logger;
}

/**
 * Find the existing memory that already covers a new one, if any.
 *
 * Today the only thing standing between the store and a pile of near
 * duplicates is the extraction prompt telling the model to check the manifest
 * first — the expensive model doing list comparison, and only when extraction
 * runs. This answers the same question directly, and can be asked from
 * anywhere a memory is about to be written.
 *
 * Returns the filename to update instead, or null to write a new file. Null is
 * also the answer when the decider is unreachable: a duplicate file is a
 * smaller loss than a merge into the wrong memory.
 */
export async function findDuplicateMemory(
  incoming: NewMemory,
  existing: readonly MemoryHeader[],
  decider: Decider,
  options?: DedupOptions,
): Promise<string | null> {
  if (existing.length === 0) return null;

  const shortlist = [...existing].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_CANDIDATES);

  const criteria: Record<string, string> = {
    [NO_DUPLICATE]: 'None of these covers the same topic — this is a genuinely new memory.',
  };
  for (const memory of shortlist) {
    criteria[memory.filename] = memory.description ?? memory.name ?? memory.filename;
  }

  const state = `New memory — ${incoming.name}: ${incoming.description}`;

  try {
    const answers = await decider.decide(
      state,
      {
        duplicate: {
          kind: 'choice',
          instructions:
            'Which existing memory already covers this same topic, such that it should be updated instead of adding a new file?',
          criteria,
        },
      },
      options?.signal,
    );

    const { value, confidence } = answers.duplicate;
    if (value === NO_DUPLICATE) return null;
    if (confidence < (options?.minConfidence ?? DEFAULT_MIN_CONFIDENCE)) return null;

    const match = shortlist.find((memory) => memory.filename === value);
    if (!match) {
      options?.logger?.warn('Decider named a memory that was not offered — ignoring', {
        choice: String(value),
      });
      return null;
    }

    options?.logger?.debug('Duplicate memory identified', { filename: match.filename });
    return match.filename;
  } catch (error) {
    options?.logger?.warn('Could not check for duplicate memory — writing a new one', {
      error: String(error),
    });
    return null;
  }
}
