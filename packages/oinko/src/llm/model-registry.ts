/**
 * One place that knows things about models.
 *
 * Before this, three modules each held part of the answer: the context window
 * lived in `model-context`, the reasoning family in `reasoning`, the default
 * model in the config schema. They aged at different speeds, which is how a
 * model could have its window fixed in one release and its reasoning handling
 * fixed in another.
 *
 * Every value here is checked against a provider catalogue — see
 * `scripts/check-models.ts`, which reports drift without touching runtime.
 */

export interface ModelFamily {
  /** Family name, used in logs and by the drift checker. */
  name: string;
  /** Matched against the full model id, provider prefix included. */
  match: RegExp;
  contextWindow: number;
  /** o-series and gpt-5+: reasoning is on, so `temperature` is refused. */
  reasoning?: boolean;
  /**
   * The exception to that: a reasoning family that takes a non-default
   * `temperature` anyway. Probed live — the gpt-5.4 line answers 200 where
   * gpt-5, gpt-5.5, gpt-5.6, gpt-6 and the o-series all answer
   * "Only the default (1) value is supported".
   */
  acceptsTemperature?: boolean;
  /** The original o1 family rejects the system role. */
  noSystemRole?: boolean;
  /**
   * Some reasoning models only accept function tools through /v1/responses.
   * On /chat/completions they refuse the request outright, and no
   * `reasoning_effort` value makes it work — 'none', which the error text
   * suggests, is not even an accepted value for these.
   */
  noToolsOnChatCompletions?: boolean;
  /**
   * Others do take tools on /chat/completions, but only with the reasoning
   * budget at zero: `reasoning_effort: 'none'`. Any other value, and the
   * absence of the field, both draw a 400. Tools and reasoning are exclusive
   * on this endpoint for these models — /v1/responses is what gives both.
   */
  toolsRequireEffortNone?: boolean;
  /**
   * This family takes text only. Probed through OpenRouter, which answers
   * 404 "No endpoints found that support image input" — the flag is the
   * exception, not the rule: everything else probed, including every reasoning
   * line and the o-series, read an image correctly.
   */
  noVision?: boolean;
}

/** Conservative window for a model nobody registered. */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Builds a matcher for a family name that may carry a provider prefix
 * ("openai/gpt-6") and a suffix ("-astra", ".1", ":batch").
 */
function family(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|/)${escaped}($|[-.:])`, 'i');
}

/**
 * Order matters: the first match wins, so a more specific family must come
 * before the shorter one it contains. 'gpt-5' precedes 'gpt-5.6' in the
 * alphabet but must follow it here, or the 1M line reads as 400k.
 */
export const MODEL_REGISTRY: ModelFamily[] = [
  // --- Anthropic: 1M line (must precede the 200k families) ---
  { name: 'claude-opus-5', match: family('claude-opus-5'), contextWindow: 1_000_000 },
  { name: 'claude-sonnet-5', match: family('claude-sonnet-5'), contextWindow: 1_000_000 },
  { name: 'claude-fable-5', match: /(^|\/)claude-fable-5/i, contextWindow: 1_000_000 },
  { name: 'claude-opus-4.6', match: family('claude-opus-4.6'), contextWindow: 1_000_000 },
  { name: 'claude-opus-4.7', match: family('claude-opus-4.7'), contextWindow: 1_000_000 },
  { name: 'claude-opus-4.8', match: family('claude-opus-4.8'), contextWindow: 1_000_000 },
  { name: 'claude-sonnet-4.5', match: family('claude-sonnet-4.5'), contextWindow: 1_000_000 },
  { name: 'claude-sonnet-4.6', match: family('claude-sonnet-4.6'), contextWindow: 1_000_000 },

  // --- Anthropic: 200k line ---
  { name: 'claude-opus-4', match: /(^|\/)claude-opus-4/i, contextWindow: 200_000 },
  { name: 'claude-sonnet-4', match: /(^|\/)claude-sonnet-4/i, contextWindow: 200_000 },
  { name: 'claude-haiku-4', match: /(^|\/)claude-haiku-4/i, contextWindow: 200_000 },
  { name: 'claude-3.5-sonnet', match: family('claude-3.5-sonnet'), contextWindow: 200_000 },
  { name: 'claude-3-opus', match: family('claude-3-opus'), contextWindow: 200_000 },
  { name: 'claude-3-sonnet', match: family('claude-3-sonnet'), contextWindow: 200_000 },
  { name: 'claude-3-haiku', match: family('claude-3-haiku'), contextWindow: 200_000 },

  // --- OpenAI: reasoning lines, most specific first ---
  {
    name: 'gpt-6',
    match: /(^|\/)gpt-6($|[-.:])/i,
    contextWindow: 1_050_000,
    reasoning: true,
    noToolsOnChatCompletions: true,
  },
  {
    name: 'gpt-5.6',
    match: family('gpt-5.6'),
    contextWindow: 1_050_000,
    reasoning: true,
    // The bare id and luna, sol and terra all take tools with effort 'none',
    // and only with it — probed live against /chat/completions.
    toolsRequireEffortNone: true,
  },
  { name: 'gpt-5.5', match: family('gpt-5.5'), contextWindow: 1_050_000, reasoning: true },
  {
    name: 'gpt-5.4-image',
    match: family('gpt-5.4-image'),
    contextWindow: 272_000,
    reasoning: true,
    acceptsTemperature: true,
  },
  {
    name: 'gpt-5.4-mini',
    match: family('gpt-5.4-mini'),
    contextWindow: 400_000,
    reasoning: true,
    acceptsTemperature: true,
  },
  {
    name: 'gpt-5.4-nano',
    match: family('gpt-5.4-nano'),
    contextWindow: 400_000,
    reasoning: true,
    acceptsTemperature: true,
  },
  {
    name: 'gpt-5.4',
    match: family('gpt-5.4'),
    contextWindow: 1_050_000,
    reasoning: true,
    acceptsTemperature: true,
  },
  { name: 'gpt-5.2-chat', match: family('gpt-5.2-chat'), contextWindow: 128_000, reasoning: true },
  { name: 'gpt-5', match: /(^|\/)gpt-5($|[-.:])/i, contextWindow: 400_000, reasoning: true },

  // --- OpenAI: o-series ---
  {
    name: 'o1',
    match: /(^|\/)o1($|[-.:])/i,
    contextWindow: 200_000,
    reasoning: true,
    noSystemRole: true,
  },
  { name: 'o3', match: /(^|\/)o3($|[-.:])/i, contextWindow: 200_000, reasoning: true },
  { name: 'o4', match: /(^|\/)o4($|[-.:])/i, contextWindow: 200_000, reasoning: true },

  // --- OpenAI: chat lines ---
  { name: 'gpt-4.1', match: family('gpt-4.1'), contextWindow: 1_047_576 },
  { name: 'gpt-4o', match: /(^|\/)gpt-4o/i, contextWindow: 128_000 },
  { name: 'gpt-4-turbo', match: family('gpt-4-turbo'), contextWindow: 128_000 },
  { name: 'gpt-4-0125', match: family('gpt-4-0125'), contextWindow: 128_000 },
  { name: 'gpt-4-1106', match: family('gpt-4-1106'), contextWindow: 128_000 },
  { name: 'gpt-oss', match: /(^|\/)gpt-oss/i, contextWindow: 131_072, noVision: true },

  // --- Google ---
  {
    name: 'gemini-2.5-flash-image',
    match: family('gemini-2.5-flash-image'),
    contextWindow: 32_768,
  },
  { name: 'gemini-2.5', match: /(^|\/)gemini-2\.5/i, contextWindow: 1_048_576 },
  { name: 'gemini-2', match: /(^|\/)gemini-2/i, contextWindow: 1_000_000 },
  { name: 'gemini-1.5-pro', match: family('gemini-1.5-pro'), contextWindow: 1_000_000 },
  { name: 'gemini-1.5-flash', match: family('gemini-1.5-flash'), contextWindow: 1_000_000 },

  // --- DeepSeek ---
  { name: 'deepseek-chat', match: /(^|\/)deepseek-chat/i, contextWindow: 163_840, noVision: true },
  {
    name: 'deepseek-r1-distill-llama-70b',
    match: family('deepseek-r1-distill-llama-70b'),
    noVision: true,
    contextWindow: 8_192,
  },
  {
    name: 'deepseek-r1-0528',
    match: family('deepseek-r1-0528'),
    contextWindow: 163_840,
    noVision: true,
  },
  {
    name: 'deepseek-r1',
    match: /(^|\/)deepseek-r1($|[-.:])/i,
    contextWindow: 64_000,
    noVision: true,
  },

  // --- Mistral ---
  {
    name: 'mistral-large-2407',
    match: family('mistral-large-2407'),
    contextWindow: 131_072,
    noVision: true,
  },
  { name: 'mistral-large', match: /(^|\/)mistral-large/i, contextWindow: 128_000, noVision: true },
  {
    name: 'mistral-medium-3-5',
    match: family('mistral-medium-3-5'),
    contextWindow: 262_144,
    noVision: true,
  },
  {
    name: 'mistral-medium',
    match: /(^|\/)mistral-medium/i,
    contextWindow: 131_072,
    noVision: true,
  },
];

/** The first family whose matcher accepts this model id, if any. */
export function findModelFamily(modelId: string): ModelFamily | undefined {
  return MODEL_REGISTRY.find((entry) => entry.match.test(modelId));
}

/** Hosts whose model ids are bare names, without a provider prefix. */
const BARE_ID_HOSTS = ['api.openai.com', 'api.anthropic.com'];

/**
 * Complains when a model id cannot belong to the endpoint it is going to.
 *
 * `openai/gpt-4o-mini` is how OpenRouter names a model; the OpenAI API calls
 * the same thing `gpt-4o-mini` and answers a prefixed id with "invalid model
 * ID". Switching `baseUrl` without revisiting every model name is an easy
 * thing to do, and the provider's error does not mention the prefix.
 *
 * Says nothing about unknown hosts: a gateway may accept any naming it likes,
 * and guessing there would block valid setups.
 */
export function checkModelSuitsEndpoint(model: string, baseUrl: string): string | undefined {
  // Fine-tune ids are their own namespace and legitimately carry separators.
  if (model.startsWith('ft:')) return undefined;

  const slash = model.indexOf('/');
  if (slash <= 0) return undefined;

  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    return undefined;
  }

  if (!BARE_ID_HOSTS.some((known) => host === known || host.endsWith(`.${known}`))) {
    return undefined;
  }

  const prefix = model.slice(0, slash + 1);
  const bare = model.slice(slash + 1);
  return (
    `Model "${model}" carries the provider prefix "${prefix}", which is OpenRouter's naming, ` +
    `but the endpoint is ${host}. Use "${bare}", or point baseUrl at OpenRouter.`
  );
}

/**
 * True when this model reads images. Vision is near-universal now, so the
 * answer is yes unless the family is known not to: assuming the opposite would
 * silently blind every model the registry has yet to learn about, and the
 * registry ages on its own clock.
 */
export function supportsVision(model: string): boolean {
  return findModelFamily(model)?.noVision !== true;
}
