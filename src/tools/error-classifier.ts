import type { Decider } from '../contracts/entities/decider.js';
import type { Logger } from '../utils/logger.js';

/** How a failed tool call should be treated. */
export const TOOL_ERROR_KINDS = ['transient', 'invalid_input', 'permanent'] as const;

export type ToolErrorKind = (typeof TOOL_ERROR_KINDS)[number];

const CRITERIA: Record<ToolErrorKind, string> = {
  transient:
    'Temporary condition that a retry can clear: timeout, connection reset, rate limit, service unavailable, deadlock.',
  invalid_input:
    'The arguments were wrong: unknown column or field, malformed value, failed validation. Retrying the same call cannot help.',
  permanent:
    'A stable condition of the system: record does not exist, permission denied, feature disabled, not implemented.',
};

/**
 * Classify a tool failure so the executor knows whether retrying is worth it.
 *
 * With `retryable: true` the executor retries anything that is not an abort,
 * so a "record not found" burns the full backoff before surfacing. This tells
 * those cases apart.
 *
 * Throws when the decider is unreachable, so the caller can fall back to the
 * blind retry it did before.
 */
export async function classifyToolError(
  error: unknown,
  toolName: string,
  decider: Decider,
  options?: { signal?: AbortSignal; logger?: Logger },
): Promise<ToolErrorKind> {
  const message = error instanceof Error ? error.message : String(error);
  const state = `Tool "${toolName}" failed with: ${message}`;

  const answers = await decider.decide(
    state,
    {
      kind: {
        kind: 'choice',
        instructions: 'What kind of failure is this?',
        criteria: CRITERIA,
      },
    },
    options?.signal,
  );

  const verdict = answers.kind.value;
  if ((TOOL_ERROR_KINDS as readonly string[]).includes(verdict)) {
    return verdict;
  }

  // An unrecognised verdict must not buy a retry.
  options?.logger?.warn('Unknown tool error classification — treating as permanent', {
    verdict: String(verdict),
  });
  return 'permanent';
}
