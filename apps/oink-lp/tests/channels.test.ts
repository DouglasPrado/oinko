import { Readable, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '@oinko/channel-cli';
import { createTelegramBot, splitMessage } from '@oinko/channel-telegram';
import { AgentRuntime, threadIdFor } from '@oinko/agent-runtime';
import { readConfig } from '../src/config.js';

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

afterEach(() => vi.restoreAllMocks());

describe('channel adapters', () => {
  it('accepts piped CLI input in order and exits without sending /exit to the model', async () => {
    const { runtime, agent } = fixture();
    let output = '';
    await runCli(
      runtime,
      'work',
      new AbortController().signal,
      Readable.from(['oi\n/reset\n/exit\nnão enviar\n']),
      new Writable({
        write(chunk, _encoding, callback) {
          output += chunk.toString();
          callback();
        },
      }),
    );
    expect(agent.chat).toHaveBeenCalledTimes(1);
    expect(agent.clearHistory).toHaveBeenCalledWith(
      threadIdFor('oinko', { channel: 'cli', connectionId: 'local', conversationId: 'work' }),
    );
    expect(output).toContain('Olá!');
  });

  it('routes Telegram replies and rejects unauthorized users and group chats', async () => {
    const { runtime, agent } = fixture();
    const config = readConfig({
      HIGGSFIELD: 'off',
      LLM_API_KEY: 'fake',
      AGENT_MODEL: 'fake',
      TELEGRAM_BOT_TOKEN: '123:fake',
      TELEGRAM_ALLOWED_USER_IDS: '42',
    });
    const bot = createTelegramBot(
      { token: config.TELEGRAM_BOT_TOKEN!, allowedUserIds: config.allowedUserIds },
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
    expect(agent.chat).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
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
      message: { ...message, voice: { file_id: 'voice', file_unique_id: 'voice-id', duration: 2 } },
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
        photo: [{ file_id: 'private', file_unique_id: 'private-id', width: 10, height: 10 }],
      },
    });
    expect(download).toHaveBeenCalledTimes(3);
  });

  it('chunks long Telegram replies without corrupting emojis', () => {
    const text = 'a'.repeat(4095) + '🐷'.repeat(3000);
    const chunks = splitMessage(text);
    expect(chunks.join('')).toBe(text);
    expect(
      chunks.every((chunk) => chunk.length <= 4096 && Buffer.from(chunk).toString() === chunk),
    ).toBe(true);
  });
});
