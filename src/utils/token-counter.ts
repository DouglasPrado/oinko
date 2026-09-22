// CJK Unified Ideographs and common CJK ranges
const CJK_REGEX =
  /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\uac00-\ud7af]/g;
const CHARS_PER_TOKEN_LATIN = 4;
const CHARS_PER_TOKEN_CJK = 1.5;

/**
 * Estimates token count for a text string.
 * Uses heuristic: ~4 chars per token for latin, ~1.5 chars per token for CJK.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  const cjkChars = (text.match(CJK_REGEX) ?? []).length;
  const nonCjkText = text.replace(CJK_REGEX, '');
  const latinChars = nonCjkText.replace(/\s+/g, ' ').length;

  const cjkTokens = cjkChars / CHARS_PER_TOKEN_CJK;
  const latinTokens = latinChars / CHARS_PER_TOKEN_LATIN;

  return Math.ceil(cjkTokens + latinTokens);
}

/**
 * What one image costs, in tokens, regardless of how long its URL is.
 *
 * The provider prices an image by its pixels, not by its address: 85 tokens
 * flat at `detail: 'low'`, and 85 plus 170 per 512px tile above that. Counting
 * the URL as text is not an approximation of this — it is a different number
 * entirely, and for an inlined data URL it is off by two orders of magnitude.
 */
const IMAGE_TOKENS_LOW = 85;
/** 85 + 170 x 4 tiles — a 1024x1024 image, the common case when nothing says. */
const IMAGE_TOKENS_DETAILED = 765;

/**
 * The shape both content types share.
 *
 * `ContentPart` (the contract) requires its fields; `LLMContentPart` (the
 * wire) makes them optional. Accepting the looser shape lets one estimator
 * serve every caller instead of each one reinventing the arithmetic — which
 * is how three of them ended up counting a data URL as prose.
 */
interface CountableContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { detail?: 'auto' | 'low' | 'high' };
}

/**
 * Estimates token count for message content, text or multimodal.
 */
export function estimateContentTokens(content: string | readonly CountableContentPart[]): number {
  if (typeof content === 'string') return estimateTokens(content);

  return content.reduce((sum, part) => {
    if (part.type === 'text') return sum + estimateTokens(part.text ?? '');
    return sum + (part.image_url?.detail === 'low' ? IMAGE_TOKENS_LOW : IMAGE_TOKENS_DETAILED);
  }, 0);
}
