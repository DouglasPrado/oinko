/** Trim a suffix in linear time without an unanchored quantified regexp. */
export function trimEndChars(value: string, characters: string): string {
  let end = value.length;
  while (end > 0 && characters.includes(value[end - 1]!)) end--;
  return value.slice(0, end);
}
