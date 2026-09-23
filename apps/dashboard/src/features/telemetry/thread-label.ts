/** Runtime channel IDs stay intact in URLs; people see the channel and conversation. */
export function threadLabel(id: string): string {
  try {
    const value: unknown = JSON.parse(id);
    if (
      Array.isArray(value) &&
      value.length === 4 &&
      value.every((part) => typeof part === 'string')
    ) {
      const channel = String(value[1]);
      return `${channel === 'telegram' ? 'Telegram' : channel === 'cli' ? 'Terminal' : channel} · ${String(value[3])}`;
    }
  } catch {
    /* SDK clients may use plain identifiers. */
  }
  return id;
}
