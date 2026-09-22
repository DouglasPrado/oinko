import { Bot, type Context } from 'grammy';
import { TranscriptionError, type AgentRuntime } from '@oinko/agent-runtime';
import { buildAgentInput, MEDIA_ERROR_MESSAGES } from './media.js';

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
  allowedUserIds: readonly string[];
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
      !allowed.has(String(ctx.from.id))
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
      try {
        const built = await buildAgentInput(ctx, config.token, signal);
        if (signal.aborted) return;
        if (built.kind === 'empty') return;
        if (built.kind === 'unsupported') {
          await reply(ctx, MEDIA_ERROR_MESSAGES[built.reason]);
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
        );
        if (!signal.aborted)
          await reply(
            ctx,
            typeof input === 'string' && ['/start', '/help'].includes(input)
              ? `${answer}\nNo Telegram, você também pode enviar fotos, imagens como arquivo e áudios.`
              : answer,
          );
      } catch (error) {
        if (!signal.aborted)
          await reply(
            ctx,
            error instanceof TranscriptionError
              ? error.message
              : 'Não consegui concluir a resposta. Tente novamente.',
          );
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
    await bot.start({
      allowed_updates: ['message'],
      onStart: () => {
        if (signal.aborted) stop();
        else console.log(`${runtime.name} · Telegram conectado`);
      },
    });
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    signal.removeEventListener('abort', stop);
    await stopping;
  }
}
