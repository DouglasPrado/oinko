import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTelegramBot, splitMessage } from '../src/index.js';
import { AgentRuntime, threadIdFor } from '@oinko/agent-runtime';

function fixture() {
  const agent = {
    chat: vi.fn().mockResolvedValue('Olá!'),
    clearHistory: vi.fn(),
    transcribe: vi.fn(),
    remember: vi.fn(),
    getUsage: vi.fn(),
  };
  return { agent, runtime: new AgentRuntime('oinko', agent) };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function waitingBot(actionFails = false) {
  const { runtime, agent } = fixture();
  let finish!: (answer: string) => void;
  let fail!: (error: Error) => void;
  agent.chat.mockImplementation(
    () =>
      new Promise<string>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
  );
  const controller = new AbortController();
  const bot = createTelegramBot(
    { token: '123:fake', allowedUserIds: ['42'] },
    runtime,
    controller.signal,
  );
  const requests: { method: string; payload: unknown }[] = [];
  bot.api.config.use(async (_previous, method, payload) => {
    if (method === 'getMe')
      return { ok: true, result: { id: 123, is_bot: true, first_name: 'Dev' } } as never;
    requests.push({ method, payload });
    if (method === 'sendChatAction' && actionFails) throw new Error('Action unavailable');
    return { ok: true, result: true } as never;
  });
  await bot.init();
  const handle = (id = 42) =>
    bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        text: 'oi',
        from: { id, is_bot: false, first_name: 'User' },
        chat: { id, type: 'private', first_name: 'User' },
      },
    });
  return {
    bot,
    controller,
    requests,
    handle,
    finish: (answer = 'Olá!') => finish(answer),
    fail: () => fail(new Error('Model unavailable')),
  };
}

describe('Telegram adapter', () => {
  it.each(['answer', 'error', 'abort'] as const)(
    'keeps typing during a slow response and stops on %s',
    async (outcome) => {
      vi.useFakeTimers();
      const pending = await waitingBot();
      await pending.handle(99);
      expect(pending.requests).toEqual([]);
      const handled = pending.handle();
      await vi.advanceTimersByTimeAsync(0);
      expect(pending.requests).toEqual([
        { method: 'sendChatAction', payload: { chat_id: 42, action: 'typing' } },
      ]);
      await vi.advanceTimersByTimeAsync(8000);
      expect(pending.requests.filter((r) => r.method === 'sendChatAction')).toHaveLength(3);
      if (outcome === 'abort') {
        pending.controller.abort();
        await vi.advanceTimersByTimeAsync(8000);
        expect(pending.requests).toHaveLength(3);
      }
      if (outcome === 'error') pending.fail();
      else pending.finish();
      await handled;
      const replies = pending.requests.filter((r) => r.method === 'sendMessage');
      expect(replies).toHaveLength(outcome === 'abort' ? 0 : 1);
      if (outcome === 'answer')
        expect(replies[0]?.payload).toEqual(expect.objectContaining({ text: 'Olá!' }));
      const count = pending.requests.length;
      await vi.advanceTimersByTimeAsync(12000);
      expect(pending.requests).toHaveLength(count);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('delivers the answer even if the typing request fails', async () => {
    vi.useFakeTimers();
    const pending = await waitingBot(true);
    const handled = pending.handle();
    await vi.advanceTimersByTimeAsync(0);
    pending.finish();
    await handled;
    expect(pending.requests).toContainEqual({
      method: 'sendMessage',
      payload: { chat_id: 42, text: 'Olá!' },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a hanging typing request without holding up the answer', async () => {
    vi.useFakeTimers();
    const pending = await waitingBot();
    let wasCancelled = false;
    pending.bot.api.config.use(async (previous, method, payload, signal) => {
      if (method !== 'sendChatAction') return previous(method, payload, signal);
      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            wasCancelled = true;
            reject(new Error('Cancelled'));
          },
          { once: true },
        );
      });
    });
    const handled = pending.handle();
    await vi.advanceTimersByTimeAsync(0);
    pending.finish();
    await handled;
    expect(wasCancelled).toBe(true);
    expect(pending.requests).toContainEqual({
      method: 'sendMessage',
      payload: { chat_id: 42, text: 'Olá!' },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, true])(
    'routes Telegram replies with open private access %s and rejects groups',
    async (allowAllPrivateChats) => {
      const { runtime, agent } = fixture();
      const bot = createTelegramBot(
        {
          token: '123:fake',
          allowedUserIds: ['42'],
          allowAllPrivateChats,
        },
        runtime,
        new AbortController().signal,
      );
      bot.botInfo = {
        id: 123,
        is_bot: true,
        first_name: 'Oinko',
        username: 'oinko_test_bot',
        can_join_groups: false,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
        has_topics_enabled: false,
        allows_users_to_create_topics: false,
        can_manage_bots: false,
        supports_join_request_queries: false,
      };
      const sent: unknown[] = [];
      bot.api.config.use(async (_previous, method, payload) => {
        if (method === 'sendChatAction') return { ok: true, result: true } as never;
        if (method === 'getFile')
          return {
            ok: true,
            result: { file_id: 'media', file_unique_id: 'unique', file_path: 'media/file' },
          } as never;
        expect(method).toBe('sendMessage');
        sent.push(payload);
        return { ok: true, result: true } as never;
      });
      const update = (userId: number, type: 'private' | 'group' = 'private', text = 'oi') => ({
        update_id: 1,
        message: {
          message_id: 1,
          date: 0,
          from: { id: userId, is_bot: false, first_name: 'User' },
          chat:
            type === 'private'
              ? { id: userId, type, first_name: 'User' }
              : { id: -1, type, title: 'Group' },
          text,
        },
      });
      await bot.handleUpdate(update(99));
      await bot.handleUpdate(update(42, 'group'));
      expect(agent.chat).toHaveBeenCalledTimes(allowAllPrivateChats ? 1 : 0);
      expect(sent).toHaveLength(allowAllPrivateChats ? 1 : 0);
      agent.chat.mockClear();
      sent.length = 0;
      await bot.handleUpdate(update(42));
      expect(agent.chat).toHaveBeenCalledWith(
        'oi',
        expect.objectContaining({
          threadId: threadIdFor('oinko', {
            channel: 'telegram',
            connectionId: '123',
            conversationId: '42',
          }),
        }),
      );
      expect(sent).toEqual([expect.objectContaining({ chat_id: 42, text: 'Olá!' })]);
      await bot.handleUpdate(update(42, 'private', '/reset@oinko_test_bot'));
      expect(agent.clearHistory).toHaveBeenCalledTimes(1);

      const download = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => new Response('media bytes'));
      const message = { ...update(42).message, text: undefined };
      await bot.handleUpdate({
        update_id: 2,
        message: {
          ...message,
          caption: 'Descreva',
          photo: [{ file_id: 'photo', file_unique_id: 'photo-id', width: 10, height: 10 }],
        },
      });
      expect(agent.chat).toHaveBeenLastCalledWith(
        [
          { type: 'text', text: 'Descreva' },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${Buffer.from('media bytes').toString('base64')}`,
              detail: 'auto',
            },
          },
        ],
        expect.objectContaining({
          threadId: threadIdFor('oinko', {
            channel: 'telegram',
            connectionId: '123',
            conversationId: '42',
          }),
        }),
      );
      agent.transcribe.mockResolvedValueOnce('Olá por áudio');
      await bot.handleUpdate({
        update_id: 3,
        message: {
          ...message,
          voice: {
            file_id: 'voice',
            file_unique_id: 'voice-id',
            duration: 2,
            mime_type: 'audio/ogg',
          },
        },
      });
      expect(agent.chat).toHaveBeenLastCalledWith('Olá por áudio', expect.any(Object));
      expect(download).toHaveBeenCalledTimes(2);
      const count = agent.chat.mock.calls.length;
      agent.transcribe.mockRejectedValueOnce(new Error('provider rejected audio'));
      await bot.handleUpdate({
        update_id: 4,
        message: {
          ...message,
          voice: { file_id: 'voice', file_unique_id: 'voice-id', duration: 2 },
        },
      });
      expect(agent.chat).toHaveBeenCalledTimes(count);
      expect(sent.at(-1)).toEqual(
        expect.objectContaining({ text: expect.stringContaining('transcrever') }),
      );
      await bot.handleUpdate({
        update_id: 5,
        message: {
          ...message,
          from: { id: 99, is_bot: false, first_name: 'Other' },
          chat: { id: 99, type: 'private', first_name: 'Other' },
          photo: [{ file_id: 'private', file_unique_id: 'private-id', width: 10, height: 10 }],
        },
      });
      expect(download).toHaveBeenCalledTimes(allowAllPrivateChats ? 4 : 3);
      if (allowAllPrivateChats) {
        expect(agent.chat).toHaveBeenLastCalledWith(
          expect.any(Array),
          expect.objectContaining({
            threadId: threadIdFor('oinko', {
              channel: 'telegram',
              connectionId: '123',
              conversationId: '99',
            }),
          }),
        );
      }
    },
  );

  it('chunks long Telegram replies without corrupting emojis', () => {
    const text = 'a'.repeat(4095) + '🐷'.repeat(3000);
    const chunks = splitMessage(text);
    expect(chunks.join('')).toBe(text);
    expect(
      chunks.every((chunk) => chunk.length <= 4096 && Buffer.from(chunk).toString() === chunk),
    ).toBe(true);
  });
});
