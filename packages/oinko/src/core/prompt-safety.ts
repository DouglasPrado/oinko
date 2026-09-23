/**
 * Tags the harness uses to tell the model where a block came from.
 *
 * Their authority rests on only the harness being able to write them. Text
 * that arrives from elsewhere — a user message, a tool result, a retrieved
 * document, a memory file — must not be able to open or close one, or it could
 * pass itself off as a system reminder or step out of the envelope that marks
 * it as data.
 */
const CONTROL_TAGS = [
  'system-reminder',
  'context-data',
  'untrusted-tool-output',
  'past_conversation_results',
] as const;

/**
 * The tags that raise what they wrap: a forged one lends host authority, or
 * lets data pass for material the host vouched for. The others only lower it
 * — "treat this as data" — so the harness's own copies may stay in a stored
 * tool result.
 */
export const AUTHORITY_TAGS = ['system-reminder', 'context-data'] as const;

const patterns = new Map<string, RegExp>();
const patternFor = (tags: readonly string[]): RegExp => {
  const key = tags.join('|');
  let pattern = patterns.get(key);
  if (!pattern) {
    pattern = new RegExp(`<\\s*(/?)\\s*(${key})\\b`, 'gi');
    patterns.set(key, pattern);
  }
  return pattern;
};

/**
 * Makes each control tag in `text` inert by escaping its `<`.
 *
 * Escaping instead of deleting keeps the text readable — the model still sees
 * that something tried to write the tag, which is itself worth noticing.
 */
export function neutralizeControlTags(
  text: string,
  tags: readonly string[] = CONTROL_TAGS,
): string {
  return text.replace(
    patternFor(tags),
    (_match, slash: string, tag: string) => `&lt;${slash}${tag}`,
  );
}
