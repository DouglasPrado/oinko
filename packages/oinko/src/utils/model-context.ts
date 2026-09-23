/**
 * Model context window detection.
 *
 * The values live in the model registry; this module is the lookup, plus the
 * warning that keeps an unknown model from being a silent problem.
 */

import { DEFAULT_CONTEXT_WINDOW, findModelFamily } from '../llm/model-registry.js';
import type { Logger } from './logger.js';

/** Models already warned about — one line per model, not per turn. */
const warned = new Set<string>();

/**
 * Get the context window size for a model.
 *
 * An unregistered model falls back to a conservative window, which is safe but
 * wasteful: a 1M model treated as 128k compacts its context with most of the
 * window still free. That used to happen silently — hence the warning.
 *
 * @param modelId — full model ID (e.g. "anthropic/claude-sonnet-5")
 * @param override — explicit value, takes precedence and never warns
 * @param logger — optional, to report an unregistered model once
 */
export function getModelContextWindow(modelId: string, override?: number, logger?: Logger): number {
  if (override !== undefined) return override;

  const family = findModelFamily(modelId);
  if (family) return family.contextWindow;

  if (!warned.has(modelId)) {
    warned.add(modelId);
    logger?.warn(
      `Model "${modelId}" is not in the model registry — assuming ${DEFAULT_CONTEXT_WINDOW} tokens of context. ` +
        'If it has a larger window, set maxContextTokens explicitly or add it to src/llm/model-registry.ts.',
      { modelId, assumedContextWindow: DEFAULT_CONTEXT_WINDOW },
    );
  }

  return DEFAULT_CONTEXT_WINDOW;
}

/** Test seam: forget which models were already warned about. */
export function resetContextWindowWarnings(): void {
  warned.clear();
}
