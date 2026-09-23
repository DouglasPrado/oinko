import type { MemoryFile } from '../memory/memory-types.js';
import { memoryFreshnessNote } from '../memory/memory-age.js';
import { estimateTokens } from '../utils/token-counter.js';
import type { ContextInjection } from './context-builder.js';

/** Memories kept in context once surfaced in a thread (the selector picks up to 5 per turn). */
const MAX_CARRIED_MEMORIES = 10;

/**
 * The memory injections of a turn: those picked for this question, and those
 * already surfaced earlier in the thread.
 *
 * Surfaced memories are excluded from the next selection so they are not paid
 * for twice — but injections are rebuilt every turn, so excluding them also
 * meant losing them. They are carried instead: re-read (an edit shows, a
 * deletion drops them), most recent first, capped so a long thread cannot
 * grow without bound. `surfaced` is the thread's set, updated in place; its
 * insertion order is the recency.
 */
export async function buildMemoryInjections(
  relevant: readonly MemoryFile[],
  surfaced: Set<string>,
  read: (filename: string) => Promise<MemoryFile | null>,
): Promise<ContextInjection[]> {
  for (const m of relevant) {
    surfaced.delete(m.filename);
    surfaced.add(m.filename);
  }
  while (surfaced.size > MAX_CARRIED_MEMORIES) {
    surfaced.delete(surfaced.values().next().value!);
  }

  const fresh = new Set(relevant.map((m) => m.filename));
  const carried: MemoryFile[] = [];
  for (const filename of [...surfaced].filter((f) => !fresh.has(f)).reverse()) {
    const memory = await read(filename);
    if (memory) carried.push(memory);
    else surfaced.delete(filename);
  }

  const injections: ContextInjection[] = [];
  if (relevant.length > 0) {
    injections.push(memoryBlock('memory:relevant', 'Relevant memories:', relevant));
  }
  // Same priority, pushed after: under a tight budget the carried block goes
  // before the memories picked for this very question.
  if (carried.length > 0) {
    injections.push(
      memoryBlock('memory:carried', 'Memories already relevant in this conversation:', carried),
    );
  }
  return injections;
}

/** One memory injection: a heading, then each memory with its freshness note. */
function memoryBlock(
  source: string,
  heading: string,
  memories: readonly MemoryFile[],
): ContextInjection {
  const lines = memories
    .map((m) => {
      const freshness = memoryFreshnessNote(m.mtimeMs);
      const header = m.name ?? m.filename;
      return `- ${header}:${freshness ? ` ${freshness}` : ''} ${m.content}`;
    })
    .join('\n');
  const content = `${heading}\n${lines}`;
  return { source, priority: 4, content, tokens: estimateTokens(content), kind: 'data' };
}
