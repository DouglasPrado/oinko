/**
 * The part of a stored message that conversation search may look at.
 *
 * Only what the user and the assistant wrote. Tool output is left out on
 * purpose: a fetched page is not the conversation, and it is where injected
 * text lives. Images are left out too — a base64 payload is not words.
 */
export const MAX_SEARCHABLE_CHARS = 32_000;

interface Part {
  type: string;
  text?: unknown;
}

export function searchableText(role: string, content: string | readonly Part[]): string {
  if (role !== 'user' && role !== 'assistant') return '';
  const text =
    typeof content === 'string'
      ? content
      : content
          .filter((p) => p.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text as string)
          .join(' ');
  return text.slice(0, MAX_SEARCHABLE_CHARS);
}

/** Same, from a stored row, where parts arrays are serialized as JSON. */
export function searchableTextFromRow(role: string, raw: string): string {
  let content: string | Part[] = raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every((p) => typeof p === 'object' && p !== null && 'type' in p)
    ) {
      content = parsed as Part[];
    }
  } catch {
    // Plain text — the common case.
  }
  return searchableText(role, content);
}

/** Lowercase without diacritics, so "decisao" finds "decisão". */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
