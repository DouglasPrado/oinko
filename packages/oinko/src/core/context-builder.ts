import type { LLMMessage, LLMContentPart } from '../llm/message-types.js';
import type { ChatMessage } from '../contracts/entities/chat-message.js';
import type { ContentPart } from '../contracts/entities/content-part.js';
import { estimateTokens, estimateContentTokens } from '../utils/token-counter.js';
import { supportsVision } from '../llm/model-registry.js';

export interface ContextInjection {
  source: string;
  priority: number;
  content: string;
  tokens: number;
}

export interface ContextBuildResult {
  messages: LLMMessage[];
  totalTokens: number;
  injections: ContextInjection[];
  /** Count of pinned messages that did not fit in the budget and were omitted. */
  droppedPinnedCount: number;
  /**
   * Count of images rewritten as text because the model cannot see. Reported
   * rather than logged here so this stays a pure function — the caller owns
   * the warning, as it already does for dropped pinned messages.
   */
  flattenedImageCount: number;
}

/**
 * Builds the full context (system prompt + injections + history) within a token budget.
 */
export function buildContext(options: {
  systemPrompt?: string;
  injections: ContextInjection[];
  history: ChatMessage[];
  maxTokens: number;
  reserveTokens: number;
  maxPinnedMessages: number;
  /** Decides whether images survive as images. Omitted, they do. */
  model?: string;
}): ContextBuildResult {
  const { systemPrompt, injections, history, maxTokens, reserveTokens, maxPinnedMessages, model } =
    options;
  const keepImages = model === undefined || supportsVision(model);
  let flattenedImageCount = 0;
  const budget = maxTokens - reserveTokens;
  let used = 0;
  const messages: LLMMessage[] = [];
  const appliedInjections: ContextInjection[] = [];

  // 1. System prompt
  let systemContent = systemPrompt ?? '';
  const systemTokens = estimateTokens(systemContent);
  used += systemTokens;

  // 2. Injections sorted by priority (higher = more important), wrapped in <system-reminder>
  const sortedInjections = [...injections].sort((a, b) => b.priority - a.priority);
  for (const injection of sortedInjections) {
    if (used + injection.tokens <= budget) {
      const safe = injection.content
        .replace(/<system-reminder>/gi, '')
        .replace(/<\/system-reminder>/gi, '');
      systemContent += `\n\n<system-reminder>\n${safe}\n</system-reminder>`;
      used += injection.tokens;
      appliedInjections.push(injection);
    }
  }

  if (systemContent) {
    messages.push({ role: 'system', content: systemContent });
  }

  const toLLM = (msg: ChatMessage): LLMMessage => {
    if (typeof msg.content !== 'string' && !keepImages) {
      flattenedImageCount += msg.content.filter((p) => p.type === 'image_url').length;
    }
    return chatMessageToLLM(msg, keepImages);
  };

  // 3. History — pinned messages reserved first, then recent ones fill the
  // rest. Selection is by budget; emission keeps the original order, because
  // a pinned `tool` result floated above its assistant is an orphan that
  // normalization drops — which is how a loaded skill used to vanish.
  const cost = (i: number): number => estimateContentTokens(history[i]!.content);
  const pinnedIdx = history.flatMap((m, i) => (m.pinned ? [i] : [])).slice(0, maxPinnedMessages);
  const reserved = new Set(pinnedIdx);
  const included = new Set<number>();

  // Track how many pinned did not fit so the caller can surface a warning
  // instead of silently losing critical context.
  let droppedPinnedCount = 0;
  for (const i of pinnedIdx) {
    const parent = parentToolCallIndex(history, i);
    const group = [i, ...(parent !== undefined ? [parent] : [])].filter((k) => !included.has(k));
    const tokens = group.reduce((sum, k) => sum + cost(k), 0);
    if (used + tokens <= budget) {
      for (const k of group) included.add(k);
      used += tokens;
    } else {
      droppedPinnedCount++;
    }
  }

  // Unpinned from most recent, until the budget runs out.
  for (let i = history.length - 1; i >= 0; i--) {
    if (included.has(i) || reserved.has(i)) continue;
    if (used + cost(i) > budget) break;
    included.add(i);
    used += cost(i);
  }

  history.forEach((m, i) => {
    if (included.has(i)) messages.push(toLLM(m));
  });

  // 4. Merge consecutive same-role messages (API constraint: no consecutive user/user)
  const merged = mergeConsecutiveMessages(messages);

  return {
    messages: merged,
    totalTokens: used,
    injections: appliedInjections,
    droppedPinnedCount,
    flattenedImageCount,
  };
}

/** Index of the assistant message that issued the call answered at `i`, if any. */
function parentToolCallIndex(history: readonly ChatMessage[], i: number): number | undefined {
  const callId = history[i]!.toolCallId;
  if (history[i]!.role !== 'tool' || !callId) return undefined;
  for (let k = i - 1; k >= 0; k--) {
    const m = history[k]!;
    if (m.role === 'assistant' && m.toolCalls?.some((tc) => tc.id === callId)) return k;
  }
  return undefined;
}

/**
 * Merge consecutive messages with the same role.
 * Prevents API errors from consecutive user or assistant messages.
 */
function mergeConsecutiveMessages(messages: LLMMessage[]): LLMMessage[] {
  if (messages.length <= 1) return messages;

  const result: LLMMessage[] = [messages[0]!];

  for (let i = 1; i < messages.length; i++) {
    const current = messages[i]!;
    const prev = result[result.length - 1]!;

    // Only merge user+user or assistant+assistant (not system, not tool)
    if (
      current.role === prev.role &&
      (current.role === 'user' || current.role === 'assistant') &&
      typeof prev.content === 'string' &&
      typeof current.content === 'string' &&
      !current.tool_call_id &&
      !prev.tool_calls
    ) {
      result[result.length - 1] = { ...prev, content: `${prev.content}\n\n${current.content}` };
    } else {
      result.push(current);
    }
  }

  return result;
}

function chatMessageToLLM(msg: ChatMessage, keepImages: boolean): LLMMessage {
  const result: LLMMessage = {
    role: msg.role,
    content:
      typeof msg.content === 'string'
        ? msg.content
        : keepImages
          ? msg.content.map(contentPartToLLM)
          : contentPartsToLLM(msg.content),
  };

  if (msg.toolCalls) {
    result.tool_calls = msg.toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));
  }

  if (msg.toolCallId) {
    result.tool_call_id = msg.toolCallId;
  }

  // Propagate pinned status so autocompact/snipCompact honour it in resumed sessions.
  if (msg.pinned) {
    (result as unknown as Record<string, unknown>)._pinned = true;
  }

  return result;
}

/** The wire shape, which differs from the contract only in optionality. */
function contentPartToLLM(part: ContentPart): LLMContentPart {
  return part.type === 'text'
    ? { type: 'text', text: part.text }
    : { type: 'image_url', image_url: part.image_url };
}

/**
 * Text rendering of multimodal content, for a model that cannot see.
 *
 * The URL is kept rather than dropped: a text model still gets to know an
 * image was sent, and where it is, which is more than a silent removal gives.
 */
function contentPartsToLLM(parts: ContentPart[]): string {
  return parts
    .map((p) => {
      if (p.type === 'text') return p.text;
      if (p.type === 'image_url' && p.image_url?.url) return `[image: ${p.image_url.url}]`;
      return '';
    })
    .filter(Boolean)
    .join('');
}
