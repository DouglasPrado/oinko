/**
 * Model context window detection.
 *
 * Maps known model IDs to their context window sizes.
 * Falls back to a conservative default for unknown models.
 */

const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Known model patterns → context window tokens.
 *
 * Matching is `includes()` in array order, so a more specific pattern must
 * come first: 'claude-opus-4' also matches 'claude-opus-4.8', which has five
 * times the window. Values checked against the OpenRouter model catalogue.
 */
const MODEL_CONTEXT_WINDOWS: { pattern: string; tokens: number }[] = [
  // Anthropic Claude — 1M context line (keep above the 200k patterns)
  { pattern: 'claude-opus-5', tokens: 1_000_000 },
  { pattern: 'claude-sonnet-5', tokens: 1_000_000 },
  { pattern: 'claude-fable-5', tokens: 1_000_000 },
  { pattern: 'claude-opus-4.6', tokens: 1_000_000 },
  { pattern: 'claude-opus-4.7', tokens: 1_000_000 },
  { pattern: 'claude-opus-4.8', tokens: 1_000_000 },
  { pattern: 'claude-sonnet-4.5', tokens: 1_000_000 },
  { pattern: 'claude-sonnet-4.6', tokens: 1_000_000 },

  // Anthropic Claude — 200k context
  { pattern: 'claude-opus-4', tokens: 200_000 },
  { pattern: 'claude-sonnet-4', tokens: 200_000 },
  { pattern: 'claude-haiku-4', tokens: 200_000 },
  { pattern: 'claude-3.5-sonnet', tokens: 200_000 },
  { pattern: 'claude-3-opus', tokens: 200_000 },
  { pattern: 'claude-3-sonnet', tokens: 200_000 },
  { pattern: 'claude-3-haiku', tokens: 200_000 },

  // OpenAI — 1M+ context (most specific first: 'gpt-5' also matches 'gpt-5.6')
  { pattern: 'gpt-6', tokens: 1_050_000 },
  { pattern: 'gpt-5.6', tokens: 1_050_000 },
  { pattern: 'gpt-5.5', tokens: 1_050_000 },
  { pattern: 'gpt-5.4-image', tokens: 272_000 },
  { pattern: 'gpt-5.4', tokens: 1_050_000 },
  { pattern: 'gpt-4.1', tokens: 1_047_576 },

  // OpenAI — 400k context (gpt-5 through 5.3, and their mini/nano/pro)
  { pattern: 'gpt-5.2-chat', tokens: 128_000 },
  { pattern: 'gpt-5', tokens: 400_000 },

  // OpenAI — older 128k line
  { pattern: 'gpt-4o', tokens: 128_000 },
  { pattern: 'gpt-4-turbo', tokens: 128_000 },
  { pattern: 'gpt-4-0125', tokens: 128_000 },
  { pattern: 'gpt-4-1106', tokens: 128_000 },
  { pattern: 'gpt-oss', tokens: 131_072 },

  // OpenAI o1/o3
  { pattern: 'o1', tokens: 200_000 },
  { pattern: 'o3', tokens: 200_000 },

  // Google Gemini
  { pattern: 'gemini-2', tokens: 1_000_000 },
  { pattern: 'gemini-1.5-pro', tokens: 1_000_000 },
  { pattern: 'gemini-1.5-flash', tokens: 1_000_000 },

  // DeepSeek
  { pattern: 'deepseek-chat', tokens: 128_000 },
  { pattern: 'deepseek-r1', tokens: 128_000 },

  // Mistral
  { pattern: 'mistral-large', tokens: 128_000 },
  { pattern: 'mistral-medium', tokens: 32_000 },
];

/**
 * Get the context window size for a model.
 *
 * @param modelId — full model ID (e.g. "anthropic/claude-sonnet-5")
 * @param override — optional explicit override (takes precedence)
 */
export function getModelContextWindow(modelId: string, override?: number): number {
  if (override !== undefined) return override;

  for (const entry of MODEL_CONTEXT_WINDOWS) {
    if (modelId.includes(entry.pattern)) return entry.tokens;
  }

  return DEFAULT_CONTEXT_WINDOW;
}
