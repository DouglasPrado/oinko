/**
 * Head-and-tail truncation for oversized text.
 *
 * Keeps the opening and the closing of the content and drops the middle, which
 * is what makes a truncated prompt or tool result still readable: the start says
 * what it is, the end says how it finished. Same ratios as microcompact.
 */

const HEAD_RATIO = 0.7;
const TAIL_RATIO = 0.2;

/**
 * Truncates `content` to roughly `maxChars`, preserving head and tail.
 *
 * Content at or under `maxChars` is returned untouched, so callers can invoke
 * this unconditionally.
 */
export function truncateMiddle(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;

  const headSize = Math.floor(maxChars * HEAD_RATIO);
  const tailSize = Math.floor(maxChars * TAIL_RATIO);
  const head = content.slice(0, headSize);
  const tail = content.slice(-tailSize);
  const omitted = content.length - headSize - tailSize;

  return `${head}\n\n[truncated ${omitted} characters]\n\n${tail}`;
}
