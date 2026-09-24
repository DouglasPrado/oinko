import type { Context } from 'grammy';

/** Ephemeral feedback must never delay or prevent the actual response. */
export function startTyping(ctx: Context, signal: AbortSignal): () => void {
  let stopped = false;
  let request: AbortController | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const update = async () => {
    if (stopped || request || !ctx.chat) return;
    request = new AbortController();
    deadline = setTimeout(() => request?.abort(), 3000);
    deadline.unref();
    try {
      await ctx.api.sendChatAction(
        ctx.chat.id,
        'typing',
        undefined,
        request.signal as unknown as Parameters<typeof ctx.api.sendChatAction>[3],
      );
    } catch {
      // A failed status update is optional; keep processing the user's message.
    } finally {
      clearTimeout(deadline);
      request = undefined;
    }
  };
  // Telegram expires chat actions after five seconds.
  const interval = setInterval(() => void update(), 4000);
  interval.unref();
  const stop = () => {
    stopped = true;
    clearInterval(interval);
    clearTimeout(deadline);
    request?.abort();
    signal.removeEventListener('abort', stop);
  };
  if (signal.aborted) stop();
  else {
    signal.addEventListener('abort', stop, { once: true });
    void update();
  }
  return stop;
}
