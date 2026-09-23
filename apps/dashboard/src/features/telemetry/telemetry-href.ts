/** Bot identity belongs to the page path; API reads retain their explicit source. */
export function telemetryHref(path: string, botId: string): string {
  const url = new URL(path, 'http://localhost');
  if (botId) {
    if (url.pathname.startsWith('/api/')) url.searchParams.set('bot', botId);
    else if (url.pathname === '/' || url.pathname.startsWith('/threads/')) {
      url.pathname = `/bots/${encodeURIComponent(botId)}/telemetria${url.pathname === '/' ? '' : url.pathname}`;
      url.searchParams.delete('bot');
    }
  } else if (url.pathname === '/') url.pathname = '/telemetria';
  return `${url.pathname}${url.search}`;
}
