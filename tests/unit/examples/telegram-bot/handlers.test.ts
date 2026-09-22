import { describe, it, expect, vi, beforeEach } from 'vitest';

const BOT_TOKEN = '123456:SEGREDO-DO-BOT';
const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

vi.mock('../../../../examples/telegram-bot/src/config.js', () => ({
  config: { telegram: { token: BOT_TOKEN } },
}));

const mockStream = vi.fn();
const mockTranscribe = vi.fn();
vi.mock('../../../../examples/telegram-bot/src/agent-factory.js', () => ({
  getAgent: () => Promise.resolve({ stream: mockStream, transcribe: mockTranscribe }),
}));

const { handleMessage } = await import('../../../../examples/telegram-bot/src/handlers.js');

/** Um stream que responde uma frase e encerra. */
function replying(text: string) {
  return function* () {
    yield { type: 'text_delta', content: text };
  };
}

interface Sent {
  replies: string[];
  ctx: Parameters<typeof handleMessage>[0];
}

function createContext(message: Record<string, unknown>): Sent {
  const replies: string[] = [];
  const ctx = {
    message,
    chat: { id: 42 },
    getFile: vi.fn().mockResolvedValue({ file_path: 'photos/f.jpg' }),
    reply: vi.fn((text: string) => {
      replies.push(text);
      return Promise.resolve({ message_id: replies.length });
    }),
    replyWithChatAction: vi.fn().mockResolvedValue(true),
    api: { editMessageText: vi.fn().mockResolvedValue(true) },
  } as unknown as Parameters<typeof handleMessage>[0];

  return { replies, ctx };
}

/**
 * O caminho completo do exemplo: o que chega do Telegram vira o que o agente
 * recebe. Os testes de `media.ts` provam a traducao; este prova que o handler
 * usa a traducao em vez da string que ele lia antes.
 */
describe('handleMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStream.mockImplementation(replying('ok'));
    mockTranscribe.mockResolvedValue('meu numero favorito e 42');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(IMAGE_BYTES, { status: 200 })),
    );
  });

  it('gives the agent a plain string for a text message', async () => {
    const { ctx } = createContext({ text: 'ola' });
    await handleMessage(ctx);

    expect(mockStream).toHaveBeenCalledWith('ola', { threadId: '42' });
  });

  it('gives the agent text and image for a captioned photo', async () => {
    const { ctx } = createContext({
      photo: [{ file_id: 'a', file_size: 500 }],
      caption: 'o que e isso?',
    });
    await handleMessage(ctx);

    const [input] = mockStream.mock.calls[0]!;
    expect(Array.isArray(input)).toBe(true);
    expect(input[0]).toEqual({ type: 'text', text: 'o que e isso?' });
    expect(input[1].type).toBe('image_url');
    expect(input[1].image_url.url.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('answers a photo it cannot handle instead of going silent', async () => {
    const { ctx, replies } = createContext({
      photo: [{ file_id: 'a', file_size: 50 * 1024 * 1024 }],
    });
    await handleMessage(ctx);

    expect(mockStream).not.toHaveBeenCalled();
    expect(replies[0]).toContain('grande demais');
  });

  it('says it cannot read a document that is not an image', async () => {
    const { ctx, replies } = createContext({
      document: { file_id: 'd', mime_type: 'application/pdf', file_size: 10 },
    });
    await handleMessage(ctx);

    expect(mockStream).not.toHaveBeenCalled();
    expect(replies[0]).toContain('nao abro');
  });

  it('stays quiet for a message carrying nothing it can use', async () => {
    const { ctx, replies } = createContext({ sticker: { file_id: 's' } });
    await handleMessage(ctx);

    expect(mockStream).not.toHaveBeenCalled();
    expect(replies).toHaveLength(0);
  });
});

/**
 * O audio nao vira turno sozinho: o handler transcreve e so entao conversa.
 * Sem isso o bot receberia bytes que o endpoint de chat nao aceita — sondado
 * contra a API, `input_audio` em /chat/completions e recusado.
 */
describe('handleMessage with audio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStream.mockImplementation(replying('ok'));
    mockTranscribe.mockResolvedValue('meu numero favorito e 42');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
    );
  });

  it('transcribes a voice note and sends the text as the turn', async () => {
    const { ctx } = createContext({ voice: { file_id: 'v', mime_type: 'audio/ogg', file_size: 900 } });
    await handleMessage(ctx);

    expect(mockTranscribe).toHaveBeenCalledWith(expect.any(Uint8Array), 'voz.ogg');
    expect(mockStream).toHaveBeenCalledWith('meu numero favorito e 42', { threadId: '42' });
  });

  it('joins the caption to the transcription instead of dropping either', async () => {
    const { ctx } = createContext({
      audio: { file_id: 'a', mime_type: 'audio/mpeg', file_size: 900 },
      caption: 'resuma',
    });
    await handleMessage(ctx);

    expect(mockStream).toHaveBeenCalledWith('resuma\n\nmeu numero favorito e 42', {
      threadId: '42',
    });
  });

  it('says so when transcription fails, rather than sending an empty turn', async () => {
    mockTranscribe.mockRejectedValue(new Error('boom'));
    const { ctx, replies } = createContext({ voice: { file_id: 'v', file_size: 900 } });
    await handleMessage(ctx);

    expect(mockStream).not.toHaveBeenCalled();
    expect(replies[0]).toContain('Nao consegui entender');
  });

  it('treats a silent audio as nothing to answer', async () => {
    mockTranscribe.mockResolvedValue('   ');
    const { ctx, replies } = createContext({ voice: { file_id: 'v', file_size: 900 } });
    await handleMessage(ctx);

    expect(mockStream).not.toHaveBeenCalled();
    expect(replies[0]).toContain('Nao consegui entender');
  });
});
