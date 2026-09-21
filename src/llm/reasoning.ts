import type { StreamChatParams } from './message-types.js';
import { findModelFamily } from './model-registry.js';

export function isReasoningModel(model: string): boolean {
  return findModelFamily(model)?.reasoning === true;
}

/**
 * Per-model request adjustments for reasoning families: temperature is not
 * accepted, so it is dropped.
 *
 * No `reasoning_effort` is sent on its own. Probing the live API showed the
 * gpt-5 line accepts function tools with no effort field at all, while the
 * gpt-6 line refuses tools on /chat/completions whatever the effort — see
 * `noToolsOnChatCompletions` in the registry. Sending a value automatically
 * only narrowed what worked.
 */
export function buildReasoningArgs(model: string): Partial<StreamChatParams> {
  if (!isReasoningModel(model)) return {};
  return { temperature: undefined };
}

/** True when this model cannot be given function tools on /chat/completions. */
export function rejectsToolsOnChatCompletions(model: string): boolean {
  return findModelFamily(model)?.noToolsOnChatCompletions === true;
}

/** Only the original o1 family rejects the system role. */
export function requiresNoSystemRole(model: string): boolean {
  return findModelFamily(model)?.noSystemRole === true;
}
