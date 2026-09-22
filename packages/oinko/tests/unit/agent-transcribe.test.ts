import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../../src/agent.js';

const AUDIO = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);

/**
 * Transcrever e a unica porta de audio que existe neste endpoint — sondado
 * contra a API, `input_audio` dentro de /chat/completions e recusado. Expor
 * isso no `Agent` evita que cada consumidor alcance o `LLMClient` por dentro
 * para fazer a mesma requisicao.
 */
describe('Agent.transcribe', () => {
  const created: { agent: Agent; root: string }[] = [];

  function createAgent(extra: Record<string, unknown> = {}): Agent {
    const root = mkdtempSync(join(tmpdir(), 'harness-audio-'));
    const agent = Agent.create({
      apiKey: 'chat-key',
      model: 'gpt-4o',
      baseUrl: 'https://chat.test/v1',
      memory: { enabled: false },
      knowledge: { enabled: false },
      dbPath: join(root, 'agent.db'),
      logLevel: 'silent',
      ...extra,
    });
    created.push({ agent, root });
    return agent;
  }

  afterEach(async () => {
    for (const { agent, root } of created.splice(0)) {
      await agent.destroy();
      rmSync(root, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  function mockFetch(text = 'o ceu esta azul') {
    return vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ text }), { status: 200 }));
  }

  it('returns the text of the audio', async () => {
    mockFetch('o ceu esta azul');
    const agent = createAgent();

    await expect(agent.transcribe(AUDIO, 'voz.ogg')).resolves.toBe('o ceu esta azul');
  });

  it('uses the chat provider when no transcription provider is configured', async () => {
    const spy = mockFetch();
    const agent = createAgent();
    await agent.transcribe(AUDIO, 'voz.ogg');

    const request = spy.mock.calls[0]![0] as Request;
    expect(request.url).toBe('https://chat.test/v1/audio/transcriptions');
    expect(request.headers.get('authorization')).toBe('Bearer chat-key');
  });

  /**
   * O default do SDK e o OpenRouter, que nao serve este endpoint: quem usa
   * audio quase sempre aponta a transcricao para outro provedor, como ja
   * acontece com embeddings.
   */
  it('honours a separate transcription provider', async () => {
    const spy = mockFetch();
    const agent = createAgent({
      transcription: {
        apiKey: 'audio-key',
        baseUrl: 'https://audio.test/v1',
        model: 'gpt-4o-transcribe',
      },
    });
    await agent.transcribe(AUDIO, 'voz.ogg');

    const request = spy.mock.calls[0]![0] as Request;
    expect(request.url).toBe('https://audio.test/v1/audio/transcriptions');
    expect(request.headers.get('authorization')).toBe('Bearer audio-key');
    expect((await request.formData()).get('model')).toBe('gpt-4o-transcribe');
  });

  it('passes the language hint through', async () => {
    const spy = mockFetch();
    const agent = createAgent();
    await agent.transcribe(AUDIO, 'voz.ogg', { language: 'pt' });

    expect((await (spy.mock.calls[0]![0] as Request).formData()).get('language')).toBe('pt');
  });
});
