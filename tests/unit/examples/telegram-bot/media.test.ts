import { describe, it, expect, vi } from 'vitest';

const BOT_TOKEN = '123456:SEGREDO-DO-BOT';

vi.mock('../../../../examples/telegram-bot/src/config.js', () => ({
  config: { telegram: { token: BOT_TOKEN } },
}));

const { buildAgentInput, pickPhotoSize, toDataUrl, audioFilename, MAX_IMAGE_BYTES, MAX_AUDIO_BYTES } =
  await import(
    '../../../../examples/telegram-bot/src/media.js'
  );

type FakeCtx = Parameters<typeof buildAgentInput>[0];

function ctxOf(message: Record<string, unknown>, filePath = 'photos/file_1.jpg'): FakeCtx {
  return {
    message,
    getFile: vi.fn().mockResolvedValue({ file_path: filePath }),
  } as FakeCtx;
}

const okFetch = (bytes: Uint8Array) =>
  vi.fn().mockResolvedValue(
    new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
  );

describe('pickPhotoSize', () => {
  it('takes the largest version that fits the cap', () => {
    const chosen = pickPhotoSize([
      { file_id: 'a', file_size: 1_000 },
      { file_id: 'c', file_size: 90_000 },
      { file_id: 'b', file_size: 20_000 },
    ]);
    expect(chosen?.file_id).toBe('c');
  });

  it('ignores versions above the cap', () => {
    const chosen = pickPhotoSize([
      { file_id: 'small', file_size: 1_000 },
      { file_id: 'huge', file_size: MAX_IMAGE_BYTES + 1 },
    ]);
    expect(chosen?.file_id).toBe('small');
  });

  it('returns nothing when every version is too large', () => {
    expect(pickPhotoSize([{ file_id: 'huge', file_size: MAX_IMAGE_BYTES + 1 }])).toBeUndefined();
  });
});

describe('toDataUrl', () => {
  it('encodes the bytes with the given mime type', () => {
    expect(toDataUrl(new Uint8Array([1, 2, 3]), 'image/png')).toBe(
      `data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`,
    );
  });
});

describe('buildAgentInput', () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  it('passes plain text straight through', async () => {
    const result = await buildAgentInput(ctxOf({ text: 'ola' }), okFetch(bytes));
    expect(result).toEqual({ kind: 'ok', input: 'ola' });
  });

  it('ignores a message with neither text nor image', async () => {
    expect(await buildAgentInput(ctxOf({ sticker: {} }), okFetch(bytes))).toEqual({ kind: 'empty' });
  });

  it('turns a photo with a caption into text plus image', async () => {
    const result = await buildAgentInput(
      ctxOf({ photo: [{ file_id: 'a', file_size: 500 }], caption: 'o que e isso?' }),
      okFetch(bytes),
    );

    expect(result.kind).toBe('ok');
    const input = (result as { input: unknown[] }).input;
    expect(input[0]).toEqual({ type: 'text', text: 'o que e isso?' });
    expect(input[1]).toMatchObject({ type: 'image_url' });
  });

  it('sends the image alone when there is no caption', async () => {
    const result = await buildAgentInput(
      ctxOf({ photo: [{ file_id: 'a', file_size: 500 }] }),
      okFetch(bytes),
    );

    const input = (result as { input: unknown[] }).input;
    expect(input).toHaveLength(1);
    expect(input[0]).toMatchObject({ type: 'image_url' });
  });

  /**
   * A URL de download do Telegram carrega o token do bot no proprio caminho.
   * Repassar essa URL ao provedor entregaria a credencial a um terceiro, e ela
   * ficaria gravada na thread, reenviada a cada turno seguinte. O teste olha o
   * que sai, nao a intencao: o token aparece na chamada ao Telegram e em lugar
   * nenhum do que o agente recebe.
   */
  it('never lets the bot token reach what the agent receives', async () => {
    const fetchSpy = okFetch(bytes);
    const result = await buildAgentInput(
      ctxOf({ photo: [{ file_id: 'a', file_size: 500 }], caption: 'olha' }),
      fetchSpy,
    );

    expect(fetchSpy.mock.calls[0]![0]).toContain(BOT_TOKEN);
    expect(JSON.stringify(result)).not.toContain(BOT_TOKEN);
    expect(JSON.stringify(result)).not.toContain('api.telegram.org');
  });

  it('inlines the image as a data URL rather than a link', async () => {
    const result = await buildAgentInput(
      ctxOf({ photo: [{ file_id: 'a', file_size: 500 }] }),
      okFetch(bytes),
    );

    const [part] = (result as { input: { image_url: { url: string } }[] }).input;
    expect(part!.image_url.url).toBe(`data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`);
  });

  it('accepts an image sent as a document, keeping its mime type', async () => {
    const result = await buildAgentInput(
      ctxOf({ document: { file_id: 'd', mime_type: 'image/png', file_size: 500 } }),
      okFetch(bytes),
    );

    const [part] = (result as { input: { image_url: { url: string } }[] }).input;
    expect(part!.image_url.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('refuses a document that is not an image', async () => {
    const result = await buildAgentInput(
      ctxOf({ document: { file_id: 'd', mime_type: 'application/pdf', file_size: 500 } }),
      okFetch(bytes),
    );
    expect(result).toEqual({ kind: 'unsupported', reason: 'not-an-image' });
  });

  it('keeps the caption of a document it cannot read', async () => {
    const result = await buildAgentInput(
      ctxOf({ document: { file_id: 'd', mime_type: 'application/pdf' }, caption: 'veja isso' }),
      okFetch(bytes),
    );
    expect(result).toEqual({ kind: 'ok', input: 'veja isso' });
  });

  it('refuses a photo whose every version is over the cap', async () => {
    const result = await buildAgentInput(
      ctxOf({ photo: [{ file_id: 'a', file_size: MAX_IMAGE_BYTES + 1 }] }),
      okFetch(bytes),
    );
    expect(result).toEqual({ kind: 'unsupported', reason: 'image-too-large' });
  });

  /**
   * `file_size` e opcional no payload do Telegram. Quando nao vem, o unico
   * tamanho confiavel e o que chegou pela rede — e ai ja e tarde para confiar
   * no que a mensagem dizia.
   */
  it('still refuses an oversized image when the payload omitted its size', async () => {
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
    const result = await buildAgentInput(ctxOf({ photo: [{ file_id: 'a' }] }), okFetch(huge));
    expect(result).toEqual({ kind: 'unsupported', reason: 'image-too-large' });
  });

  it('reports a failed download instead of sending a broken image', async () => {
    const failing = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }));
    const result = await buildAgentInput(ctxOf({ photo: [{ file_id: 'a', file_size: 500 }] }), failing);
    expect(result).toEqual({ kind: 'unsupported', reason: 'download-failed' });
  });
});

describe('audioFilename', () => {
  /**
   * O provedor escolhe o decoder pela extensao. Nota de voz do Telegram e
   * sempre OGG/Opus; chamar de `.mp3` devolve "invalid file format".
   */
  it('derives the extension from the mime type', () => {
    expect(audioFilename('audio/ogg')).toBe('voz.ogg');
    expect(audioFilename('audio/mpeg')).toBe('voz.mp3');
    expect(audioFilename('audio/x-m4a')).toBe('voz.m4a');
    expect(audioFilename('audio/wav')).toBe('voz.wav');
  });

  /**
   * Opus e um codec dentro de um conteiner OGG, nao um formato de arquivo
   * proprio. Sondado contra a API: `.opus` volta 400 "Invalid file format", os
   * mesmos bytes como `.ogg` transcrevem.
   */
  it('names opus audio as ogg, the container the provider accepts', () => {
    expect(audioFilename('audio/opus')).toBe('voz.ogg');
  });

  /** A lista que o provedor aceita, conferida contra a API. */
  it('only ever produces an extension the provider accepts', () => {
    const aceitas = new Set(['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm']);
    const mimes = [
      'audio/ogg', 'audio/oga', 'audio/opus', 'audio/mpeg', 'audio/mp3', 'audio/mp4',
      'audio/m4a', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/flac',
      undefined, 'audio/qualquer-coisa',
    ];

    for (const mime of mimes) {
      expect(aceitas, String(mime)).toContain(audioFilename(mime).split('.')[1]);
    }
  });

  it('falls back to ogg, which is what a voice note always is', () => {
    expect(audioFilename(undefined)).toBe('voz.ogg');
    expect(audioFilename('audio/desconhecido')).toBe('voz.ogg');
  });
});

describe('buildAgentInput with audio', () => {
  const bytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);

  it('hands a voice note over for transcription', async () => {
    const result = await buildAgentInput(
      ctxOf({ voice: { file_id: 'v', mime_type: 'audio/ogg', file_size: 900 } }),
      okFetch(bytes),
    );

    expect(result).toEqual({
      kind: 'audio',
      audio: bytes,
      filename: 'voz.ogg',
      caption: '',
    });
  });

  it('keeps the caption that came with the audio', async () => {
    const result = await buildAgentInput(
      ctxOf({
        audio: { file_id: 'a', mime_type: 'audio/mpeg', file_size: 900 },
        caption: 'resuma isso',
      }),
      okFetch(bytes),
    );

    expect(result).toMatchObject({ kind: 'audio', filename: 'voz.mp3', caption: 'resuma isso' });
  });

  it('accepts audio sent as a document', async () => {
    const result = await buildAgentInput(
      ctxOf({ document: { file_id: 'd', mime_type: 'audio/wav', file_size: 900 } }),
      okFetch(bytes),
    );

    expect(result).toMatchObject({ kind: 'audio', filename: 'voz.wav' });
  });

  it('refuses audio above the cap', async () => {
    const result = await buildAgentInput(
      ctxOf({ voice: { file_id: 'v', mime_type: 'audio/ogg', file_size: MAX_AUDIO_BYTES + 1 } }),
      okFetch(bytes),
    );

    expect(result).toEqual({ kind: 'unsupported', reason: 'audio-too-large' });
  });

  it('never lets the bot token reach what the agent receives', async () => {
    const fetchSpy = okFetch(bytes);
    const result = await buildAgentInput(
      ctxOf({ voice: { file_id: 'v', mime_type: 'audio/ogg', file_size: 900 } }),
      fetchSpy,
    );

    expect(fetchSpy.mock.calls[0]![0]).toContain(BOT_TOKEN);
    expect(JSON.stringify(result)).not.toContain(BOT_TOKEN);
  });
});
