import type { Decider } from '../contracts/entities/decider.js';
import type { LLMMessage } from '../llm/message-types.js';
import type { Logger } from '../utils/logger.js';

/**
 * Whether the loop is getting anywhere.
 *
 * `maxIterations` is a blind cut: it treats an agent closing in on an answer
 * and one retrying the same failing call exactly alike. The first is stopped
 * too early, the second runs to the limit burning tokens on a result nobody
 * will use.
 */
export const PROGRESS_QUESTION = {
  kind: 'bool',
  instructions:
    'These are the most recent turns of an agent working on a task. The agent is making progress toward answering, rather than repeating itself or retrying something that keeps failing.',
  criteria: {
    true: 'Each turn adds something: new information, a different approach, a step completed.',
    false:
      'The same call or the same reasoning repeats with the same outcome, with no new ground covered.',
  },
} as const;

/**
 * Deliberately high. Stopping a loop that was working costs the user an answer
 * they already paid for, while letting an unproductive one run only costs
 * tokens until `maxIterations`.
 */
const DEFAULT_MIN_CONFIDENCE = 0.8;

/** How many trailing messages describe "what just happened". */
const TAIL_MESSAGES = 8;

/** Enough of each message to judge repetition without shipping the transcript. */
const MAX_MESSAGE_CHARS = 400;

export interface ProgressGateOptions {
  minConfidence?: number;
  signal?: AbortSignal;
  logger?: Logger;
}

function renderTail(messages: readonly LLMMessage[]): string {
  return messages
    .slice(-TAIL_MESSAGES)
    .map((message) => {
      const text = typeof message.content === 'string' ? message.content : '[multimodal]';
      const clipped =
        text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
      return `${message.role}: ${clipped}`;
    })
    .join('\n');
}

/**
 * Decides whether the loop should keep going.
 *
 * Biased towards continuing: no decider, nothing to judge, an unsure verdict
 * or an unreachable engine all answer "yes". Only a confident "this is going
 * in circles" stops the loop early — everything else falls through to
 * `maxIterations`, which is the behaviour without this gate.
 */
export async function isLoopProductive(
  messages: readonly LLMMessage[],
  iteration: number,
  decider: Decider,
  options?: ProgressGateOptions,
): Promise<boolean> {
  if (messages.length === 0) return true;

  try {
    const answers = await decider.decide(
      renderTail(messages),
      { progressing: PROGRESS_QUESTION },
      options?.signal,
    );

    const { value, confidence } = answers.progressing;
    if (value) return true;
    if (confidence < (options?.minConfidence ?? DEFAULT_MIN_CONFIDENCE)) return true;

    options?.logger?.warn('Loop appears to be repeating itself — stopping early', {
      iteration,
      confidence,
    });
    return false;
  } catch (error) {
    options?.logger?.warn('Could not judge loop progress — continuing', { error: String(error) });
    return true;
  }
}
