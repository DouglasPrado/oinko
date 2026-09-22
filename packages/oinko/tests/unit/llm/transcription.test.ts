import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMClient } from '../../../src/llm/llm-client.js';

const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 0x04]);

function mockFetch(response: Response) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

const ok = (text: string) => new Response(JSON.stringify({ text }), { status: 200 });

/**
 * A transcricao nao cabe no caminho das outras chamadas: o corpo e multipart,
 * nao JSON, e o endpoint e outro. Probado contra a API — `input_audio` dentro
 * de /chat/completions e recusado ("Content blocks are expected to be either
 * text or image_url type"), entao transcrever e o unico caminho que existe.
 */
describe('LLMClient.transcribe', () => {
  let client: LLMClient;

  beforeEach(() => {
    client = new LLMClient({
      apiKey: 'test-key',
      model: 'test/model',
      baseUrl: 'https://api.test.com/v1',
      transcriptionModel: 'whisper-1',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the transcribed text', async () => {
    mockFetch(ok('o ceu esta azul'));
    await expect(client.transcribe({ audio: AUDIO, filename: 'v.ogg' })).resolves.toEqual({
      text: 'o ceu esta azul',
    });
  });

  it('posts to the transcription endpoint', async () => {
    const spy = mockFetch(ok('ok'));
    await client.transcribe({ audio: AUDIO, filename: 'v.ogg' });

    const request = spy.mock.calls[0]![0] as Request;
    expect(request.url).toBe('https://api.test.com/v1/audio/transcriptions');
    expect(request.method).toBe('POST');
  });

  /**
   * O boundary do multipart e escolhido por quem monta o FormData. Fixar um
   * Content-Type na mao aqui produziria um corpo que o servidor nao consegue
   * separar, e o erro apareceria como "campo file ausente".
   */
  it('lets fetch set the multipart content type', async () => {
    const spy = mockFetch(ok('ok'));
    await client.transcribe({ audio: AUDIO, filename: 'v.ogg' });

    const request = spy.mock.calls[0]![0] as Request;
    expect(request.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
    expect(request.headers.get('authorization')).toBe('Bearer test-key');
  });

  it('sends the audio and the model in the form', async () => {
    const spy = mockFetch(ok('ok'));
    await client.transcribe({ audio: AUDIO, filename: 'voz.ogg' });

    const form = await (spy.mock.calls[0]![0] as Request).formData();
    expect(form.get('model')).toBe('whisper-1');
    const file = form.get('file') as File;
    expect(file.name).toBe('voz.ogg');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(AUDIO);
  });

  it('lets the caller override the model per call', async () => {
    const spy = mockFetch(ok('ok'));
    await client.transcribe({ audio: AUDIO, filename: 'v.ogg', model: 'gpt-4o-transcribe' });

    const form = await (spy.mock.calls[0]![0] as Request).formData();
    expect(form.get('model')).toBe('gpt-4o-transcribe');
  });

  it('passes a language hint only when given', async () => {
    const spy = mockFetch(ok('ok'));
    await client.transcribe({ audio: AUDIO, filename: 'v.ogg', language: 'pt' });
    expect((await (spy.mock.calls[0]![0] as Request).formData()).get('language')).toBe('pt');

    vi.restoreAllMocks();
    const bare = mockFetch(ok('ok'));
    await client.transcribe({ audio: AUDIO, filename: 'v.ogg' });
    expect((await (bare.mock.calls[0]![0] as Request).formData()).get('language')).toBeNull();
  });

  it('reports a provider error instead of returning empty text', async () => {
    mockFetch(new Response(JSON.stringify({ error: { message: 'bad audio' } }), { status: 400 }));
    await expect(client.transcribe({ audio: AUDIO, filename: 'v.ogg' })).rejects.toThrow(
      /bad audio/,
    );
  });

  it('falls back to the default model when none is configured', async () => {
    const bare = new LLMClient({
      apiKey: 'k',
      model: 'test/model',
      baseUrl: 'https://api.test.com/v1',
    });
    const spy = mockFetch(ok('ok'));
    await bare.transcribe({ audio: AUDIO, filename: 'v.ogg' });

    expect((await (spy.mock.calls[0]![0] as Request).formData()).get('model')).toBe('whisper-1');
  });
});
