import { describe, expect, it, vi } from 'vitest';
import { GrammyError } from 'grammy';
import { AgentRuntime, type RuntimeCommands } from '@oinko/agent-runtime';
import { createTelegramBot, sendToChat } from '../src/index.js';

function commands(): RuntimeCommands & { calls: { route: unknown; text: string; meta: unknown }[] } {
  const calls: { route: unknown; text: string; meta: unknown }[] = [];
  return {
    calls,
    handles: (text: string) => text.startsWith('/tarefa') || text.startsWith('/status'),
    handle: (route, text, meta) => {
      calls.push({ route, text, meta });
      return 'Trabalho registrado: #abcd1234 (shop)';
    },
  };
}

async function botWith(runtimeCommands: RuntimeCommands) {
  const agent = { chat: vi.fn(() => new Promise<string>(() => undefined)), clearHistory: vi.fn(), transcribe: vi.fn(), remember: vi.fn(), getUsage: vi.fn() };
  const runtime = new AgentRuntime('dev', agent, runtimeCommands);
  const bot = createTelegramBot({ token: '123:fake', allowedUserIds: ['42'] }, runtime, new AbortController().signal);
  const sent: { method: string; payload: unknown }[] = [];
  bot.api.config.use(async (_previous, method, payload) => {
    if (method === 'getMe') return { ok: true, result: { id: 123, is_bot: true, first_name: 'Dev' } } as never;
    sent.push({ method, payload });
    return { ok: true, result: true } as never;
  });
  await bot.init();
  const update = (messageId: number, text: string) =>
    bot.handleUpdate({
      update_id: messageId,
      message: { message_id: messageId, date: 0, text, from: { id: 42, is_bot: false, first_name: 'U' }, chat: { id: 42, type: 'private', first_name: 'U' } },
    });
  return { bot, sent, update, agent };
}

describe('Telegram adapter for programming runs', () => {
  it('answers run commands without waiting for the LLM and keys requests by update so a redelivery is deduplicated', async () => {
    const control = commands();
    const { update, sent, agent } = await botWith(control);
    await update(7, '/tarefa shop Corrija o checkout');
    await update(7, '/tarefa shop Corrija o checkout');
    expect(agent.chat).not.toHaveBeenCalled();
    expect(control.calls.map((call) => call.meta)).toEqual([
      expect.objectContaining({ idempotencyKey: 'telegram:123:42:7', userId: '42' }),
      expect.objectContaining({ idempotencyKey: 'telegram:123:42:7' }),
    ]);
    expect(control.calls[0]!.route).toEqual({ channel: 'telegram', connectionId: '123', conversationId: '42' });
    expect(sent.filter((request) => request.method === 'sendMessage')).toHaveLength(2);
  });

  it('delivers progress only through the connection that owns the conversation and surfaces rate limits', async () => {
    const { bot, sent } = await botWith(commands());
    await sendToChat(bot, '999:42', 'de outra conexão');
    await sendToChat(bot, '123:not-a-chat', 'inválido');
    expect(sent).toEqual([]);
    await sendToChat(bot, '123:42', '#abcd1234: ciclo 1 concluído');
    expect(sent).toEqual([{ method: 'sendMessage', payload: expect.objectContaining({ chat_id: 42, text: '#abcd1234: ciclo 1 concluído' }) }]);
    bot.api.config.use(async (_previous, method, payload) => {
      throw new GrammyError('Too Many Requests', { ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } }, method, payload);
    });
    await expect(sendToChat(bot, '123:42', 'mais progresso')).rejects.toMatchObject({ name: 'RateLimited', retryAfterMs: 7000 });
  });
});
