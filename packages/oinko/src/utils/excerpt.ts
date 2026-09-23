import { foldText } from './conversation-text.js';

/**
 * A window of at most `maxChars` around the first matched term, the term
 * marked between « and ». Matching ignores case and accents, like the search.
 * Without a match, the start of the text.
 */
export function excerptAround(
  text: string,
  foldedTerms: readonly string[],
  maxChars: number,
): string {
  // Room for the two markers and the two ellipses, so the result fits maxChars.
  const room = Math.max(8, maxChars - 4);
  const folded = foldText(text);
  let index = -1;
  let length = 0;
  for (const term of foldedTerms) {
    const at = folded.indexOf(term);
    if (at !== -1 && (index === -1 || at < index)) {
      index = at;
      length = term.length;
    }
  }

  if (index === -1) {
    return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
  }

  const start = Math.max(0, Math.min(index - Math.floor((room - length) / 2), text.length - room));
  const end = Math.min(text.length, start + room);
  const marked =
    text.slice(start, index) +
    '«' +
    text.slice(index, index + length) +
    '»' +
    text.slice(index + length, end);
  return `${start > 0 ? '…' : ''}${marked}${end < text.length ? '…' : ''}`;
}
