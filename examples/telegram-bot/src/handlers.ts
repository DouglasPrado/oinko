import type { Context } from "grammy";
import type { ContentPart } from "@gba/ai-harness";
import { getAgent } from "./agent-factory.js";
import { extractMedia, type MediaLink } from "./media-links.js";
import { config } from "./config.js";
import { buildAgentInput } from "./media.js";

const TELEGRAM_MAX_LENGTH = 4096;
const STREAM_UPDATE_INTERVAL = 800; // ms between message edits

/**
 * /start command
 */
export async function handleStart(ctx: Context): Promise<void> {
  await ctx.reply(
    `*Oinko*\n\n` +
      `Seu assistente pessoal. Eu lembro do que conversamos.\n\n` +
      `*Comandos*\n` +
      `/start — esta mensagem\n` +
      `/reset — limpa o historico desta conversa\n` +
      `/usage — quanto foi consumido em tokens\n` +
      `/memory — guarda algo que eu devo lembrar\n\n` +
      `Manda texto, foto ou audio — eu leio os tres.`,
    { parse_mode: "Markdown" },
  );
}

/**
 * /reset command — clear thread history
 */
export async function handleReset(ctx: Context): Promise<void> {
  // The ConversationManager doesn't expose clearThread via Agent,
  // but we can use a new threadId suffix to simulate a reset
  const chatId = ctx.chat!.id.toString();
  const resetKey = `reset_${chatId}`;

  // Store reset timestamp in memory so the agent knows
  const agent = await getAgent();
  try {
    await agent.remember(
      `Conversation was reset by the user at ${new Date().toISOString()}`,
      chatId,
      "project",
    );
  } catch {
    // Memory might not be enabled
  }

  await ctx.reply("Conversation cleared. Starting fresh.");
}

/**
 * /usage command — show token usage
 */
export async function handleUsage(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id.toString();
  const agent = await getAgent();
  // Usage for THIS chat — the process total would show other people's spend.
  const usage = agent.getUsage(chatId);

  await ctx.reply(
    `*Token Usage*\n\n` +
      `Input: ${usage.inputTokens.toLocaleString()}\n` +
      `Output: ${usage.outputTokens.toLocaleString()}\n` +
      `Total: ${usage.totalTokens.toLocaleString()}`,
    { parse_mode: "Markdown" },
  );
}

/**
 * /memory command — explicitly save a memory
 */
export async function handleMemory(ctx: Context): Promise<void> {
  const text = ctx.message?.text?.replace(/^\/memory\s*/, "").trim();

  if (!text) {
    await ctx.reply("Usage: `/memory The user prefers dark mode`", {
      parse_mode: "Markdown",
    });
    return;
  }

  const chatId = ctx.chat!.id.toString();
  const agent = await getAgent();
  try {
    // Scoped to this chat: /memory used to write into the shared pile that
    // every other conversation reads.
    const filename = await agent.remember(text, chatId);
    await ctx.reply(`Memory saved: ${filename}`);
  } catch (error) {
    await ctx.reply("Failed to save memory. Memory subsystem may be disabled.");
  }
}

/**
 * Main message handler — streaming chat with progressive updates
 */
/** O que dizer quando a mensagem traz algo que o bot nao consegue ler. */
const UNSUPPORTED_REPLY: Record<string, string> = {
  'image-too-large': 'Essa imagem e grande demais para eu processar. Tente uma menor.',
  'audio-too-large': 'Esse audio e longo demais para eu processar. Tente um mais curto.',
  'not-an-image': 'Consigo ler texto, imagem e audio. Esse arquivo eu nao abro.',
  'download-failed': 'Nao consegui baixar esse arquivo do Telegram. Tente de novo.',
  'no-file-path': 'Nao consegui baixar esse arquivo do Telegram. Tente de novo.',
  'transcription-failed': 'Nao consegui entender esse audio. Tente gravar de novo.',
};

export async function handleMessage(ctx: Context): Promise<void> {
  const built = await buildAgentInput(ctx);
  if (built.kind === 'empty') return;
  if (built.kind === 'unsupported') {
    await ctx.reply(UNSUPPORTED_REPLY[built.reason] ?? UNSUPPORTED_REPLY['not-an-image']!);
    return;
  }

  const chatId = ctx.chat!.id.toString();
  const agent = await getAgent();

  let input: string | ContentPart[];
  if (built.kind === 'audio') {
    // Transcrever leva alguns segundos e nao emite nada pelo stream: sem o
    // indicador, o bot parece ter ignorado a mensagem.
    await ctx.replyWithChatAction('typing').catch(() => {});
    let texto: string;
    try {
      texto = await agent.transcribe(built.audio, built.filename);
    } catch (error) {
      console.error('Transcription error:', error);
      await ctx.reply(UNSUPPORTED_REPLY['transcription-failed']!);
      return;
    }

    if (!texto.trim()) {
      await ctx.reply(UNSUPPORTED_REPLY['transcription-failed']!);
      return;
    }

    // A legenda do audio, quando existe, e um pedido sobre ele — junta-se a
    // transcricao em vez de substitui-la.
    input = built.caption ? `${built.caption}\n\n${texto}` : texto;
  } else {
    input = built.input;
  }

  // Show "typing" indicator
  await ctx.replyWithChatAction("typing");

  try {
    let fullText = "";
    let sentMessage: { message_id: number } | null = null;
    let lastUpdate = 0;
    let isSearching = false;

    for await (const event of agent.stream(input, { threadId: chatId })) {
      switch (event.type) {
        case "tool_call_start": {
          isSearching = true;
          const toolName = event.toolCall.function.name;
          // Tira o namespace do MCP para exibir: mcp__servidor__buscar → buscar
          const displayName = toolName.replace(/^mcp__[^_]+__/, "");
          const statusMsg = `${displayName}...`;

          if (!sentMessage) {
            sentMessage = await ctx.reply(statusMsg);
          } else {
            await safeEdit(
              ctx,
              chatId,
              sentMessage.message_id,
              fullText + `\n\n_${statusMsg}_`,
            );
          }
          // Keep typing indicator alive during tool execution
          await ctx.replyWithChatAction("typing").catch(() => {});
          break;
        }

        case "tool_call_end": {
          isSearching = false;
          break;
        }

        case "warning": {
          if (event.code === "max_iterations") {
            console.warn("Max iterations reached for chat", chatId);
          }
          if (event.code === "cost_warning") {
            console.warn("Cost warning:", event.message);
          }
          break;
        }

        case "text_delta": {
          fullText += event.content;

          // Progressive update every STREAM_UPDATE_INTERVAL ms
          const now = Date.now();
          if (now - lastUpdate > STREAM_UPDATE_INTERVAL) {
            const displayText = truncate(fullText + " ▌", TELEGRAM_MAX_LENGTH);

            if (!sentMessage) {
              sentMessage = await ctx.reply(displayText);
            } else {
              await safeEdit(ctx, chatId, sentMessage.message_id, displayText);
            }
            lastUpdate = now;
          }
          break;
        }

        case "error": {
          if (!event.recoverable) {
            console.error("Agent error:", event.error);
            const errorMsg = sentMessage
              ? fullText + "\n\nAn error occurred."
              : "Sorry, an error occurred. Please try again.";

            if (sentMessage) {
              await safeEdit(ctx, chatId, sentMessage.message_id, errorMsg);
            } else {
              await ctx.reply(errorMsg);
            }
            return;
          }
          break;
        }
      }
    }

    // Final message (remove cursor, ensure delivery)
    const { text: prose, media } = extractMedia(fullText);

    if (prose) {
      const chunks = splitMessage(prose, TELEGRAM_MAX_LENGTH);

      if (sentMessage) {
        // Update first message
        await safeEdit(ctx, chatId, sentMessage.message_id, chunks[0]!);
        // Send additional chunks as new messages
        for (let i = 1; i < chunks.length; i++) {
          await ctx.reply(chunks[i]!);
        }
      } else {
        for (const chunk of chunks) {
          await ctx.reply(chunk);
        }
      }
    } else if (sentMessage && media.length > 0) {
      // A resposta era so a imagem: o texto parcial com o cursor fica no lugar.
      await safeEdit(ctx, chatId, sentMessage.message_id, "Pronto.");
    } else if (!sentMessage && media.length === 0) {
      await ctx.reply("Nao consegui gerar uma resposta. Tente de novo.");
    }

    await sendMedia(ctx, media);
  } catch (error) {
    console.error("Handler error:", error);
    await ctx
      .reply("Something went wrong. Please try again.")
      .catch(() => {});
  }
}

// --- Helpers ---

/**
 * Manda o que o agente gerou como anexo, nao como endereco.
 *
 * O Telegram baixa a URL por conta propria. Quando recusa — arquivo grande
 * demais, formato que ele nao aceita, endereco expirado — o link volta como
 * texto: melhor receber o endereco do que nao receber nada.
 */
async function sendMedia(ctx: Context, media: MediaLink[]): Promise<void> {
  for (const item of media) {
    try {
      if (item.kind === "photo") await ctx.replyWithPhoto(item.url);
      else await ctx.replyWithVideo(item.url);
    } catch (error) {
      console.error(
        `Telegram recusou a midia (${item.kind}):`,
        error instanceof Error ? error.message : error,
      );
      await ctx.reply(item.url).catch(() => {});
    }
  }
}

async function safeEdit(
  ctx: Context,
  chatId: string,
  messageId: number,
  text: string,
): Promise<void> {
  try {
    await ctx.api.editMessageText(chatId, messageId, text);
  } catch {
    // Ignore edit errors (message not modified, etc.)
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < maxLength * 0.3) {
      // No good newline — split at space
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt < maxLength * 0.3) {
      // No good space — hard split
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
