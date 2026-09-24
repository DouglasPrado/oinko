import type { LLMMessage } from '../../llm/message-types.js';
import type { LLMClient } from '../../llm/llm-client.js';
import { estimateContentTokens, estimateTokens } from '../../utils/token-counter.js';

interface AutocompactOptions {
  maxContextTokens: number;
  compactionThreshold: number; // 0.0-1.0, e.g. 0.8 = compact at 80% usage
  tailProtection: number; // Number of recent messages to always preserve
  summarize?: (transcript: string, previous: string) => Promise<string>;
  preserveCurrentTurn?: boolean;
}

interface AutocompactResult {
  messages: LLMMessage[];
  tokensFreed: number;
}

function estimateMessagesTokens(messages: readonly LLMMessage[]): number {
  return messages.reduce(
    (sum, m) =>
      sum +
      estimateContentTokens(m.content) +
      (m.tool_calls ? estimateTokens(JSON.stringify(m.tool_calls)) : 0),
    0,
  );
}

/**
 * Summarizes conversation history via LLM when token usage exceeds threshold.
 * Preserves: system messages (always), tail messages (recent context).
 * Returns null if compaction not needed or fails.
 */
export async function autocompact(
  messages: readonly LLMMessage[],
  client: LLMClient,
  options: AutocompactOptions,
): Promise<AutocompactResult | null> {
  const { maxContextTokens, compactionThreshold, tailProtection } = options;

  const currentTokens = estimateMessagesTokens(messages);
  const threshold = maxContextTokens * compactionThreshold;

  if (currentTokens < threshold) return null;

  // Split into: system messages, a compactable region (early), and a protected
  // tail. Pinned messages in the early region are preserved in their ORIGINAL
  // position (not floated to the top) to keep assistant.tool_calls followed by
  // their `tool` results — OpenAI rejects any other order.
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');
  let tailCount = Math.min(tailProtection, nonSystem.length);
  if (options.preserveCurrentTurn) {
    let start = nonSystem.length - tailCount;
    const first = nonSystem[start];
    if (first?.role === 'tool' && first.tool_call_id) {
      const parent = nonSystem.findIndex((m) =>
        m.tool_calls?.some((c) => c.id === first.tool_call_id),
      );
      if (parent >= 0) start = parent;
    }
    tailCount = nonSystem.length - start;
  }
  const earlyNonSystem = nonSystem.slice(0, nonSystem.length - tailCount);
  const tailMessages = nonSystem.slice(-tailCount);

  // Within the early region, split into pinned (kept verbatim, in place) and
  // compactable (summarized). The relative order of pinned messages to each
  // other is preserved; they are emitted at the top of the early slot.
  //
  // A pinned `tool` result is worthless without the assistant that issued its
  // call — normalization drops the orphan — so that assistant is kept too.
  // Its other calls, whose results get summarized, are stripped downstream.
  const isPinned = (m: LLMMessage): boolean =>
    (m as unknown as Record<string, unknown>)._pinned === true;
  const pinnedToolCallIds = new Set(
    earlyNonSystem
      .filter((m) => m.role === 'tool' && isPinned(m) && m.tool_call_id)
      .map((m) => m.tool_call_id!),
  );
  const currentUser = options.preserveCurrentTurn
    ? [...nonSystem].reverse().find((m) => m.role === 'user')
    : undefined;
  const keep = (m: LLMMessage): boolean =>
    isPinned(m) ||
    m === currentUser ||
    (m.role === 'assistant' && !!m.tool_calls?.some((tc) => pinnedToolCallIds.has(tc.id)));
  const earlyPinned = earlyNonSystem.filter(keep);
  const toCompact = earlyNonSystem.filter((m) => !keep(m));

  if (toCompact.length === 0) return null;

  // Build conversation text for summarization
  const conversationText = toCompact
    .map((m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `${m.role}${m.tool_call_id ? ` reference=${m.tool_call_id}` : ''}: ${content.slice(0, 2000)}${m.tool_calls ? `\nCALLS: ${JSON.stringify(m.tool_calls)}` : ''}`;
    })
    .join('\n');

  try {
    const response = options.summarize
      ? { content: await options.summarize(conversationText, '') }
      : await client.chat({
          messages: [
            {
              role: 'system',
              content:
                'You are a conversation summarizer. Create a concise summary of the following conversation, preserving key facts, decisions, tool results, and context needed for continuation. Be factual and specific. Output only the summary.',
            },
            { role: 'user', content: conversationText },
          ],
          temperature: 0,
          maxTokens: 1000,
        });

    const summaryMessage: LLMMessage = {
      role: 'user',
      content: `[Conversation summary — earlier messages were compacted to save context]\n\n${response.content}`,
      // Mark as compaction boundary — should survive subsequent compactions
      _pinned: true,
    } as LLMMessage & { _pinned?: boolean };

    const compactedMessages = [...systemMessages, ...earlyPinned, summaryMessage, ...tailMessages];

    const newTokens = estimateMessagesTokens(compactedMessages);
    return {
      messages: compactedMessages,
      tokensFreed: currentTokens - newTokens,
    };
  } catch {
    return null;
  }
}
