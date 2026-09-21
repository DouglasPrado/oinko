import type { StreamChatParams } from './message-types.js';
import { findModelFamily } from './model-registry.js';

export function isReasoningModel(model: string): boolean {
  return findModelFamily(model)?.reasoning === true;
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

/** Only the original o1 family rejects the system role. */
export function requiresNoSystemRole(model: string): boolean {
  return findModelFamily(model)?.noSystemRole === true;
}
