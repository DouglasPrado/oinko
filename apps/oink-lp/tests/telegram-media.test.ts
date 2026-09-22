import type { Context } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import { buildAgentInput, MAX_IMAGE_BYTES, MAX_AUDIO_BYTES } from '@oinko/channel-telegram';
import { AgentRuntime, threadIdFor } from '@oinko/agent-runtime';

function context(message: object) {
  const getFile = vi.fn().mockResolvedValue({ file_path: 'photos/file.jpg' });
  return { ctx: { message, api: { getFile } } as unknown as Context, getFile };
}

describe('Telegram media', () => {
  it('downloads the largest photo within the limit and sends inline bytes with its caption', async () => {
    const { ctx, getFile } = context({
      caption: 'O que aparece aqui?',
      photo: [
        { file_id: 'small', file_size: 10, width: 10, height: 10 },
        { file_id: 'fits', file_size: 20, width: 20, height: 20 },
        { file_id: 'oversized', file_size: MAX_IMAGE_BYTES + 1, width: 100, height: 100 },
      ],
    });
    const download = vi.fn<typeof fetch>().mockResolvedValue(new Response('image-bytes'));
    const built = await buildAgentInput(ctx, 'secret-token', undefined, download);
    expect(getFile).toHaveBeenCalledWith('fits');
    expect(built).toEqual({
      kind: 'ok',
      input: [
        { type: 'text', text: 'O que aparece aqui?' },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${Buffer.from('image-bytes').toString('base64')}`,
            detail: 'auto',
          },
        },
      ],
    });
    expect(JSON.stringify(built)).not.toContain('secret-token');
  });

  it.each([
    [{ voice: { file_id: 'voice', mime_type: 'audio/ogg' } }, 'voz.ogg'],
    [{ audio: { file_id: 'music', mime_type: 'audio/mpeg' } }, 'voz.mp3'],
    [{ document: { file_id: 'file', mime_type: 'audio/wav' } }, 'voz.wav'],
  ])('accepts audio variants with the right extension', async (message, filename) => {
    const { ctx } = context({ ...message, caption: 'Resuma' });
    const result = await buildAgentInput(
      ctx,
      'token',
      undefined,
      vi.fn<typeof fetch>().mockResolvedValue(new Response('audio')),
    );
    expect(result).toMatchObject({ kind: 'audio', filename, caption: 'Resuma' });
  });

  it('accepts an image document without inventing a caption', async () => {
    const { ctx } = context({ document: { file_id: 'png', mime_type: 'image/png' } });
    const result = await buildAgentInput(
      ctx,
      'token',
      undefined,
      vi.fn<typeof fetch>().mockResolvedValue(new Response('png')),
    );
    expect(result).toMatchObject({
      kind: 'ok',
      input: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,cG5n' } }],
    });
  });

  it.each([
    [{ voice: { file_id: 'voice', file_size: MAX_AUDIO_BYTES + 1 } }, 'audio-too-large'],
    [
      { document: { file_id: 'png', mime_type: 'image/png', file_size: MAX_IMAGE_BYTES + 1 } },
      'image-too-large',
    ],
    [
      { document: { file_id: 'pdf', mime_type: 'application/pdf' }, caption: 'leia' },
      'unsupported-file',
    ],
  ])('rejects oversized or unsupported files before download', async (message, reason) => {
    const { ctx, getFile } = context(message);
    expect(await buildAgentInput(ctx, 'token')).toEqual({ kind: 'unsupported', reason });
    expect(getFile).not.toHaveBeenCalled();
  });

  it('enforces the real download size even without Telegram metadata', async () => {
    const { ctx } = context({ photo: [{ file_id: 'photo' }] });
    const download = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new Uint8Array(MAX_IMAGE_BYTES + 1)));
    expect(await buildAgentInput(ctx, 'token', undefined, download)).toEqual({
      kind: 'unsupported',
      reason: 'image-too-large',
    });
  });

  it('turns download failures into a safe error without exposing the token', async () => {
    const { ctx } = context({ photo: [{ file_id: 'photo' }] });
    const download = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('https://api.telegram.org/file/botSECRET/path'));
    expect(await buildAgentInput(ctx, 'SECRET', undefined, download)).toEqual({
      kind: 'unsupported',
      reason: 'download-failed',
    });
  });

  it('transcribes in the shared runtime, preserves caption and scope, and never executes spoken commands', async () => {
    const agent = {
      chat: vi.fn().mockResolvedValue('ok'),
      transcribe: vi.fn().mockResolvedValue('/reset'),
      clearHistory: vi.fn(),
      remember: vi.fn(),
      getUsage: vi.fn(),
    };
    const runtime = new AgentRuntime('oinko', agent);
    const route = { channel: 'telegram' as const, connectionId: '123', conversationId: '42' };
    const signal = new AbortController().signal;
    const audio = {
      kind: 'audio' as const,
      audio: new Uint8Array([1, 2]),
      filename: 'voz.ogg',
      caption: 'Explique',
    };
    await runtime.handle(route, audio, signal);
    expect(agent.transcribe).toHaveBeenCalledWith(audio.audio, 'voz.ogg', { signal });
    expect(agent.chat).toHaveBeenCalledWith('Explique\n\n/reset', {
      threadId: threadIdFor('oinko', route),
      signal,
    });
    expect(agent.clearHistory).not.toHaveBeenCalled();
    agent.transcribe.mockResolvedValueOnce('  ');
    await expect(runtime.handle(route, audio)).rejects.toThrow(/transcri/i);
    expect(agent.chat).toHaveBeenCalledTimes(1);
  });
});
