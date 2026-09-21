import type { StreamChatParams } from './message-types.js';

// Matches reasoning families: o1, o3, o4, and the gpt-5/gpt-6 lines. Accepts an
// optional "openai/" prefix so it works with both OpenRouter and direct OpenAI.
const REASONING_MODEL_RE = /^(openai\/)?(o[134](-|$)|gpt-[56](\.|-|$))/i;

export function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_RE.test(model);
}

/**
 * Per-model request adjustments for reasoning families.
 *
 * Two of them:
 * - temperature is not accepted, so it is dropped;
 * - a reasoning budget cannot coexist with function tools on
 *   /chat/completions ("Function tools with reasoning_effort are not
 *   supported"), so a turn that carries tools asks for no effort. Without
 *   this the provider rejects the whole request and the agent cannot use
 *   tools at all on these models.
 *
 * Callers that set `reasoningEffort` explicitly keep their value — this only
 * fills the gap where the request would otherwise be refused.
 */
export function buildReasoningArgs(model: string, hasTools: boolean): Partial<StreamChatParams> {
  if (!isReasoningModel(model)) return {};

  return {
    temperature: undefined,
    ...(hasTools && { reasoningEffort: 'none' as const }),
  };
}

// Only the original o1 family rejects system role; o3+, o4, gpt-5 and gpt-6 accept it.
export function requiresNoSystemRole(model: string): boolean {
  return /^(openai\/)?o1(-|$)/i.test(model);
}
