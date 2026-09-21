import { describe, it, expect, vi, afterEach } from 'vitest';
import { LLMClient } from '../../../src/llm/llm-client.js';

/** SSE mínimo que o parser aceita: um delta de texto e o finish. */
function sseResponse(text: string): Response {
  const body = [
    `data: {"choices":[{"delta":{"content":"${text}"},"index":0}]}\n\n`,
    'data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
  ].join('');
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(body));
        c.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

describe('LLMClient — fetch injetado (gateway in-process)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('manda o chat para o handler injetado, sem tocar o fetch global', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    const handler = vi.fn(async () => sseResponse('via gateway'));

    const client = new LLMClient({
      apiKey: 'test',
      model: 'test-model',
      fetch: handler,
    });

    const chunks: string[] = [];
    for await (const chunk of client.streamChat({
      messages: [{ role: 'user', content: 'oi' }],
    })) {
      if (chunk.type === 'content') chunks.push(chunk.data);
    }

    expect(handler).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
    expect(chunks.join('')).toBe('via gateway');
  });

  it('entrega ao handler uma Request com o path e o body do dialeto OpenAI', async () => {
    let seen: Request | undefined;
    const handler = vi.fn(async (req: Request) => {
      seen = req.clone();
      return sseResponse('ok');
    });

    const client = new LLMClient({
      apiKey: 'segredo',
      model: 'meu-modelo',
      baseUrl: 'http://gateway.local/v1',
      fetch: handler,
    });

    for await (const _ of client.streamChat({
      messages: [{ role: 'user', content: 'oi' }],
    })) {
      /* drena */
    }

    expect(seen).toBeDefined();
    expect(new URL(seen!.url).pathname).toBe('/v1/chat/completions');
    expect(seen!.method).toBe('POST');
    expect(seen!.headers.get('authorization')).toBe('Bearer segredo');

    const body = (await seen!.json()) as { model: string; stream: boolean };
    expect(body.model).toBe('meu-modelo');
    expect(body.stream).toBe(true);
  });

  it('NÃO desvia embeddings para o handler — o gateway não roteia essa rota', async () => {
    const handler = vi.fn(async () => sseResponse('nao deveria'));
    const globalFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 }),
      );

    const client = new LLMClient({ apiKey: 'test', model: 'm', fetch: handler });
    const out = await client.embed(['texto']);

    expect(handler).not.toHaveBeenCalled();
    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(out).toEqual([[0.1, 0.2]]);
  });

  it('sem fetch injetado, mantém o guard de SSRF sobre a baseUrl', () => {
    expect(
      () => new LLMClient({ apiKey: 'k', model: 'm', baseUrl: 'http://localhost:8080/v1' }),
    ).toThrow(/SSRF/);
  });

  it('com fetch injetado, aceita baseUrl local — não há request de rede', () => {
    expect(
      () =>
        new LLMClient({
          apiKey: 'k',
          model: 'm',
          baseUrl: 'http://localhost:8080/v1',
          fetch: async () => sseResponse('ok'),
        }),
    ).not.toThrow();
  });
});
