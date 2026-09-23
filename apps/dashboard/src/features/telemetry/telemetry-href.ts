/** Preserva o bot também em links de detalhes, downloads e atualizações ao vivo. */
export function telemetryHref(path: string, botId: string): string {
  const url = new URL(path, 'http://localhost');
  if (botId) url.searchParams.set('bot', botId);
  return `${url.pathname}${url.search}`;
}
