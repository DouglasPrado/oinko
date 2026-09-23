import type { Context } from 'grammy';
import type { ContentPart } from '@oinko/core';
import type { AudioInput } from '@oinko/agent-runtime';

// Adapted from examples/telegram-bot/src/media.ts. Keep transport credentials
// here: the model receives inline image bytes or transcribed text, never URLs
// containing the Telegram bot token.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

type MediaFailure =
  'image-too-large' | 'audio-too-large' | 'unsupported-file' | 'download-failed' | 'no-file-path';
export type BuiltInput =
  | { kind: 'ok'; input: string | ContentPart[] }
  | AudioInput
  | { kind: 'unsupported'; reason: MediaFailure }
  | { kind: 'empty' };

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/oga': 'oga',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'mp4',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
};
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

interface TelegramFile {
  file_id: string;
  file_size?: number;
}

export async function buildAgentInput(
  ctx: Context,
  token: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<BuiltInput> {
  const message = ctx.message;
  const caption = message?.caption ?? '';
  const document = message?.document;
  const voice = message?.voice ?? message?.audio;
  const audioDocument = document?.mime_type?.startsWith('audio/') ? document : undefined;
  const audio = voice ?? audioDocument;
  if (audio) {
    const mime = audio.mime_type?.split(';')[0]?.trim().toLowerCase();
    if (mime && !AUDIO_EXTENSIONS[mime]) return { kind: 'unsupported', reason: 'unsupported-file' };
    const downloaded = await downloadFile(
      ctx,
      token,
      audio,
      MAX_AUDIO_BYTES,
      'audio-too-large',
      signal,
      fetchImpl,
    );
    if (downloaded.kind !== 'ok') return downloaded;
    return {
      kind: 'audio',
      audio: downloaded.bytes,
      filename: `voz.${AUDIO_EXTENSIONS[mime ?? ''] ?? 'ogg'}`,
      caption,
    };
  }

  let file: TelegramFile | undefined;
  let mimeType = 'image/jpeg';
  if (message?.photo) {
    // Request the selected size explicitly; ctx.getFile() would choose the
    // largest variant even when it exceeds the configured size limit.
    file = message.photo
      .filter((photo) => (photo.file_size ?? 0) <= MAX_IMAGE_BYTES)
      .sort((a, b) => (b.file_size ?? b.width * b.height) - (a.file_size ?? a.width * a.height))[0];
    if (!file) return { kind: 'unsupported', reason: 'image-too-large' };
  } else if (document) {
    mimeType = document.mime_type?.toLowerCase() ?? '';
    if (!IMAGE_TYPES.has(mimeType)) return { kind: 'unsupported', reason: 'unsupported-file' };
    file = document;
  }
  if (!file) return message?.text ? { kind: 'ok', input: message.text } : { kind: 'empty' };
  const downloaded = await downloadFile(
    ctx,
    token,
    file,
    MAX_IMAGE_BYTES,
    'image-too-large',
    signal,
    fetchImpl,
  );
  if (downloaded.kind !== 'ok') return downloaded;
  const image: ContentPart = {
    type: 'image_url',
    image_url: {
      url: `data:${mimeType};base64,${Buffer.from(downloaded.bytes).toString('base64')}`,
      detail: 'auto',
    },
  };
  return { kind: 'ok', input: caption ? [{ type: 'text', text: caption }, image] : [image] };
}

async function downloadFile(
  ctx: Context,
  token: string,
  file: TelegramFile,
  limit: number,
  tooLarge: 'image-too-large' | 'audio-too-large',
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<{ kind: 'ok'; bytes: Uint8Array } | { kind: 'unsupported'; reason: MediaFailure }> {
  if ((file.file_size ?? 0) > limit) return { kind: 'unsupported', reason: tooLarge };
  try {
    signal?.throwIfAborted();
    const remote = await ctx.api.getFile(file.file_id);
    if (!remote.file_path) return { kind: 'unsupported', reason: 'no-file-path' };
    const timeout = AbortSignal.timeout(30_000);
    const response = await fetchImpl(
      `https://api.telegram.org/file/bot${token}/${remote.file_path}`,
      {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        redirect: 'error',
      },
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return { kind: 'unsupported', reason: 'download-failed' };
    }
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body.cancel();
      return { kind: 'unsupported', reason: tooLarge };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          return { kind: 'unsupported', reason: tooLarge };
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return { kind: 'ok', bytes: Buffer.concat(chunks, size) };
  } catch {
    return { kind: 'unsupported', reason: 'download-failed' };
  }
}

export const MEDIA_ERROR_MESSAGES: Record<MediaFailure, string> = {
  'image-too-large': 'Essa imagem ultrapassa o limite de 5 MB. Envie uma menor.',
  'audio-too-large': 'Esse áudio ultrapassa o limite de 20 MB. Envie um menor.',
  'unsupported-file':
    'Envie uma foto, imagem (JPEG, PNG, WebP ou GIF) ou áudio em formato compatível.',
  'download-failed': 'Não consegui baixar o arquivo do Telegram. Tente enviá-lo novamente.',
  'no-file-path': 'O Telegram não disponibilizou esse arquivo. Tente enviá-lo novamente.',
};
