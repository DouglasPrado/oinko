import { Bot, GrammyError, type Context } from 'grammy';
import {
  TranscriptionError,
  type AgentRuntime,
  type ChannelProvider,
  type NotificationRegistry,
} from '@oinko/agent-runtime';
import { buildAgentInput, MEDIA_ERROR_MESSAGES } from './media.js';
import { startTyping } from './typing.js';

// Count UTF-16 units conservatively and never split an emoji surrogate pair.
export function splitMessage(text: string): string[] {
  const chunks: string[] = [];
  let chunk = '';
  for (const character of text) {
    if (chunk.length + character.length > 4096) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export interface TelegramOptions {
  token: string;
  onReady?: () => void;
  allowedUserIds: readonly string[];
  allowAllPrivateChats?: boolean;
  /** Registers this connection as the sender of asynchronous run progress. */
  notifications?: NotificationRegistry;
}

/**
 * Sends a message to a chat outside a reply (run progress). Rate limits are
 * surfaced with their retry delay so the caller can back off; failures never
 * reach the run itself.
 */
export async function sendToChat(bot: Pick<Bot, 'api' | 'botInfo'>, conversationKey: string, text: string) {
  const separator = conversationKey.indexOf(':');
  const connectionId = conversationKey.slice(0, separator);
  const chatId = conversationKey.slice(separator + 1);
  // Only the connection that owns the conversation may write to it.
  if (connectionId !== String(bot.botInfo.id) || !/^-?\d+$/.test(chatId)) return;
  for (const chunk of splitMessage(text)) {
    try {
      await bot.api.sendMessage(Number(chatId), chunk);
    } catch (error) {
      if (error instanceof GrammyError && error.error_code === 429)
        throw Object.assign(new Error('Telegram rate limit'), {
          name: 'RateLimited',
          retryAfterMs: (error.parameters.retry_after ?? 1) * 1000,
        });
      throw error;
    }
  }
}

export { buildAgentInput, MAX_IMAGE_BYTES, MAX_AUDIO_BYTES } from './media.js';

export function createTelegramBot(
  config: TelegramOptions,
  runtime: AgentRuntime,
  signal: AbortSignal,
) {
  const bot = new Bot(config.token);
  const allowed = new Set(config.allowedUserIds);
  bot.use(async (ctx, next) => {
    // Personal agent: private chats only; group history must not expose memory.
    if (
      signal.aborted ||
      ctx.chat?.type !== 'private' ||
      !ctx.from ||
      (config.allowAllPrivateChats !== true && !allowed.has(String(ctx.from.id)))
    )
      return;
    await next();
  });
  const reply = async (ctx: Context, text: string) => {
    for (const chunk of splitMessage(text || '(sem resposta textual)')) await ctx.reply(chunk);
  };
  bot.on(
    ['message:text', 'message:photo', 'message:voice', 'message:audio', 'message:document'],
    async (ctx) => {
      const stopTyping = startTyping(ctx, signal);
      const respond = async (text: string) => {
        stopTyping();
        await reply(ctx, text);
      };
      try {
        const built = await buildAgentInput(ctx, config.token, signal);
        if (signal.aborted) return;
        if (built.kind === 'empty') return;
        if (built.kind === 'unsupported') {
          await respond(MEDIA_ERROR_MESSAGES[built.reason]);
          return;
        }
        let input = built.kind === 'audio' ? built : built.input;
        if (typeof input === 'string') {
          input = input.replace(/^\/(start|help|reset|usage|memory)@\w+(?=\s|$)/, '/$1');
        }
        const answer = await runtime.handle(
          {
            channel: 'telegram',
            connectionId: String(ctx.me.id),
            conversationId: String(ctx.chat.id),
          },
          input,
          signal,
          {
            userId: String(ctx.from.id),
            // A redelivered update keeps its id: requests are deduplicated by it.
            idempotencyKey: `telegram:${ctx.me.id}:${ctx.chat.id}:${ctx.message.message_id}`,
          },
        );
        if (!signal.aborted)
          await respond(
            typeof input === 'string' && ['/start', '/help'].includes(input)
              ? `${answer}\nNo Telegram, você também pode enviar fotos, imagens como arquivo e áudios.`
              : answer,
          );
      } catch (error) {
        if (!signal.aborted)
          await respond(
            error instanceof TranscriptionError
              ? error.message
              : 'Não consegui concluir a resposta. Tente novamente.',
          );
      } finally {
        stopTyping();
      }
    },
  );
  bot.on('message', async (ctx) => {
    await reply(ctx, 'Envie texto, foto, imagem como arquivo ou áudio.');
  });
  // Avoid logging raw SDK errors, which can contain bot credentials or input.
  bot.catch(() => {
    console.error('Falha ao processar uma atualização do Telegram.');
  });
  return bot;
}

export async function runTelegram(
  config: TelegramOptions,
  runtime: AgentRuntime,
  signal: AbortSignal,
): Promise<void> {
  const bot = createTelegramBot(config, runtime, signal);
  let unregister: (() => void) | undefined;
  let stopping: Promise<void> | undefined;
  const stop = () => {
    if (bot.isRunning())
      stopping = bot.stop().catch(() => console.error('Falha ao encerrar o Telegram.'));
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    if (signal.aborted) return;
    // grammY's Node typings reference its legacy AbortSignal polyfill;
    // native signals implement the same cancellation protocol at runtime.
    await bot.init(signal as unknown as Parameters<Bot['init']>[0]);
    if (signal.aborted) return;
    unregister = config.notifications?.register('telegram', (key, text) => sendToChat(bot, key, text));
    await bot.start({
      allowed_updates: ['message'],
      onStart: () => {
        if (signal.aborted) stop();
        else {
          config.onReady?.();
          console.log(`${runtime.name} · Telegram conectado`);
        }
      },
    });
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    unregister?.();
    signal.removeEventListener('abort', stop);
    await stopping;
  }
}

export const telegramChannel: ChannelProvider = async (options, context) => {
  const { token, allowedUserIds, allowAllPrivateChats } = options;
  if (
    typeof token !== 'string' ||
    !token.trim() ||
    !Array.isArray(allowedUserIds) ||
    (!allowedUserIds.length && allowAllPrivateChats !== true) ||
    allowedUserIds.some((id) => typeof id !== 'string' || !/^[1-9]\d*$/.test(id))
  ) {
    throw new Error('Configure token e allowedUserIds do Telegram.');
  }
  await runTelegram(
    {
      token,
      allowedUserIds,
      allowAllPrivateChats: allowAllPrivateChats === true,
      onReady: context.ready,
      ...(context.notifications && { notifications: context.notifications }),
    },
    context.runtime,
    context.signal,
  );
};
