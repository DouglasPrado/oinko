import { describe, it, expect, vi, afterEach } from 'vitest';
import { Agent } from '../../../src/agent.js';

/** Responde com o texto da ultima mensagem do usuario que enxergou. */
function mockEcho(): { prompts: () => string[] } {
  const prompts: string[] = [];

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('/embeddings')) {
      return new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), { status: 200 });
    }

    const body = JSON.parse(String(init?.body)) as {
      messages: { role: string; content: string }[];
    };
    const ultima = [...body.messages].reverse().find((m) => m.role === 'user');
    prompts.push(String(ultima?.content ?? ''));

    // Um tempinho para que execucoes concorrentes se sobreponham de verdade.
    await new Promise((r) => setTimeout(r, 30));

    const texto = String(ultima?.content ?? '').toUpperCase();
    const sse =
      `data: {"choices":[{"delta":{"content":${JSON.stringify(texto)}},"index":0}]}\n\n` +
      'data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n';

    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(sse));
          c.close();
        },
      }),
      { status: 200 },
    );
  });

  return { prompts: () => prompts };
}

describe('turnos concorrentes na mesma thread', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Duas mensagens seguidas da mesma pessoa e o caso comum de qualquer bot de
   * chat. Sem o turno inteiro sob o mutex, as duas perguntas entravam no
   * historico antes de qualquer resposta, e as duas execucoes chamavam o
   * modelo vendo a mesma coisa — a primeira pergunta ficava sem resposta
   * propria, e ninguem via erro.
   */
  it('cada turno enxerga so as mensagens anteriores ao dele', async () => {
    const { prompts } = mockEcho();
    const agent = Agent.create({
      apiKey: 'k',
      memory: { enabled: false },
      knowledge: { enabled: false },
      logLevel: 'silent',
    });

    const [a, b] = await Promise.all([
      agent.chat('alfa', { threadId: 'mesma' }),
      agent.chat('beta', { threadId: 'mesma' }),
    ]);

    // Cada execucao respondeu a SUA pergunta.
    expect([a, b].sort()).toEqual(['ALFA', 'BETA']);
    // E cada chamada ao modelo viu uma pergunta diferente como ultima.
    expect([...new Set(prompts())].sort()).toEqual(['alfa', 'beta']);

    await agent.destroy();
  });

  it('grava o historico em pares completos, sem intercalar', async () => {
    mockEcho();
    const agent = Agent.create({
      apiKey: 'k',
      memory: { enabled: false },
      knowledge: { enabled: false },
      logLevel: 'silent',
    });

    await Promise.all([
      agent.chat('um', { threadId: 't' }),
      agent.chat('dois', { threadId: 't' }),
      agent.chat('tres', { threadId: 't' }),
    ]);

    const historico = agent.getHistory('t');
    expect(historico).toHaveLength(6);
    for (let i = 0; i < historico.length; i += 2) {
      expect(historico[i]!.role).toBe('user');
      expect(historico[i + 1]!.role).toBe('assistant');
    }

    await agent.destroy();
  });

  it('threads diferentes seguem correndo em paralelo', async () => {
    mockEcho();
    const agent = Agent.create({
      apiKey: 'k',
      memory: { enabled: false },
      knowledge: { enabled: false },
      logLevel: 'silent',
    });

    const inicio = Date.now();
    await Promise.all([
      agent.chat('a', { threadId: 'x' }),
      agent.chat('b', { threadId: 'y' }),
      agent.chat('c', { threadId: 'z' }),
    ]);
    const decorrido = Date.now() - inicio;

    // Serializadas seriam ~90ms; em paralelo ficam perto de 30ms.
    expect(decorrido).toBeLessThan(80);

    await agent.destroy();
  });
});
