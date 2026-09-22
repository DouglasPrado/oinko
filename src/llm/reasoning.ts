import type { ReasoningEffort } from './message-types.js';
import { findModelFamily } from './model-registry.js';

export function isReasoningModel(model: string): boolean {
  return findModelFamily(model)?.reasoning === true;
}

/** What the model family forces on a request, once the caller's intent is known. */
export interface ReasoningPlan {
  /**
   * The caller's `temperature` must not reach the wire: this model refuses
   * anything but the default. Sending it anyway is a 400 for the whole
   * request, not a silently ignored field.
   */
  dropTemperature: boolean;
  /** The effort to send, whether the caller named it or the family forces it. */
  reasoningEffort?: ReasoningEffort;
}

/**
 * Per-model request adjustments for reasoning families, all of them traced to
 * a live probe of /chat/completions rather than to the provider's docs:
 *
 * - reasoning families refuse a non-default `temperature` — except the gpt-5.4
 *   line, which takes it (`acceptsTemperature`);
 * - the gpt-5.6 line takes function tools only with `reasoning_effort: 'none'`
 *   (`toolsRequireEffortNone`). Without the field the provider applies its
 *   default and rejects the request;
 * - the gpt-6 line takes no tools here at any effort, and does not accept
 *   `'none'` as a value either (`noToolsOnChatCompletions`);
 * - `'none'` is the hinge for temperature too: with reasoning off, the same
 *   model that refused a temperature accepts it. So the effort is resolved
 *   first, and the temperature decision reads it.
 *
 * The caller's own `reasoningEffort` always wins over the forced one — a
 * deliberate value is never silently rewritten.
 */
export function buildReasoningArgs(
  model: string,
  params: { hasTools?: boolean; reasoningEffort?: ReasoningEffort },
): ReasoningPlan {
  if (!isReasoningModel(model)) return { dropTemperature: false };

  const forced =
    params.hasTools === true && toolsRequireEffortNone(model) ? ('none' as const) : undefined;
  const reasoningEffort = params.reasoningEffort ?? forced;

  const dropTemperature = reasoningEffort !== 'none' && !acceptsTemperature(model);

  return { dropTemperature, ...(reasoningEffort !== undefined && { reasoningEffort }) };
}

/** True when this model cannot be given function tools on /chat/completions. */
export function rejectsToolsOnChatCompletions(model: string): boolean {
  return findModelFamily(model)?.noToolsOnChatCompletions === true;
}

/**
 * True when this model takes function tools on /chat/completions only with
 * `reasoning_effort: 'none'` — tools at the cost of reasoning.
 */
export function toolsRequireEffortNone(model: string): boolean {
  return findModelFamily(model)?.toolsRequireEffortNone === true;
}

/** True when this reasoning model takes a non-default temperature anyway. */
export function acceptsTemperature(model: string): boolean {
  return findModelFamily(model)?.acceptsTemperature === true;
}

/** Only the original o1 family rejects the system role. */
export function requiresNoSystemRole(model: string): boolean {
  return findModelFamily(model)?.noSystemRole === true;
}
