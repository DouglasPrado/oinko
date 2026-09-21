import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../../src/agent.js';

/**
 * Uma resposta SSE minima com o `usage` que o teste quiser.
 *
 * O consumo por thread so aparece depois de uma execucao de verdade: sem
 * dirigir o loop, toda thread le zero e um `getUsage` que ignora o argumento
 * passaria no teste sem separar nada.
 */
const respostaSse = (tokens: number): Response =>
  new Response(
    [
      'data: {"choices":[{"delta":{"content":"ok"},"index":0}]}\n\n',
      `data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":${tokens},"completion_tokens":${tokens},"total_tokens":${tokens * 2}}}\n\n`,
    ].join(''),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

const consumir = async (agente: Agent, entrada: string, threadId: string): Promise<void> => {
  for await (const _evento of agente.stream(entrada, { threadId })) {
    void _evento;
  }
};

/**
 * O que o `Agent` expoe depois da auditoria.
 *
 * Achados 1.2 e 1.3: `remember` aceitava escopo como terceiro argumento
 * OPCIONAL, e quem esquecia gravava no acervo global de todo mundo; `getUsage`
 * devolvia o contador do processo, entao qualquer pessoa via o consumo alheio.
 *
 * A correcao move o escopo para argumento obrigatorio e da ao acervo global uma
 * porta com nome — `rememberGlobal`. Esquecer deixa de ser possivel; escolher o
 * global passa a ser dito em voz alta.
 */
describe('Agent — escopo obrigatorio de memoria e consumo por thread', () => {
  const criados: Array<{ agente: Agent; raiz: string }> = [];

  const criarAgente = (): Agent => {
    const raiz = mkdtempSync(join(tmpdir(), 'harness-agente-'));
    const agente = Agent.create({
      apiKey: 'chave-de-teste',
      memory: { enabled: true, memoryDir: join(raiz, 'memoria'), extractionEnabled: false },
      knowledge: { enabled: false },
      dbPath: join(raiz, 'agent.db'),
    });
    criados.push({ agente, raiz });
    return agente;
  };

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const { agente, raiz } of criados.splice(0)) {
      await agente.destroy();
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('remember grava na thread informada, e recall de outra thread nao a enxerga', async () => {
    const agente = criarAgente();

    await agente.remember('a pessoa A prefere respostas curtas', 'thread-a');

    const daPropria = await agente.recall('preferencia', 'thread-a');
    const daOutra = await agente.recall('preferencia', 'thread-b');

    expect(daPropria.length).toBeGreaterThan(0);
    expect(daOutra).toEqual([]);
  });

  it('rememberGlobal e a unica porta para o acervo compartilhado', async () => {
    const agente = criarAgente();

    await agente.rememberGlobal('responder sempre em portugues', 'project');

    const daThread = await agente.recall('idioma', 'qualquer-thread');

    expect(daThread.length).toBeGreaterThan(0);
  });

  it('getUsage devolve o consumo apenas da thread perguntada', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const endereco = typeof url === 'string' ? url : url.toString();
      if (endereco.includes('/embeddings')) {
        return new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), { status: 200 });
      }
      return respostaSse(10);
    });

    const agente = criarAgente();
    await consumir(agente, 'primeira pergunta', 'thread-a');

    expect(agente.getUsage('thread-a').totalTokens).toBe(20);
    // A thread que nunca falou nao pode enxergar o consumo da que falou.
    expect(agente.getUsage('thread-b')).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  });

  it('getUsage sem thread continua devolvendo o total do processo', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const endereco = typeof url === 'string' ? url : url.toString();
      if (endereco.includes('/embeddings')) {
        return new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), { status: 200 });
      }
      return respostaSse(10);
    });

    const agente = criarAgente();
    await consumir(agente, 'pergunta de A', 'thread-a');
    await consumir(agente, 'pergunta de B', 'thread-b');

    // O total continua existindo para quem opera o processo — o que muda e que
    // ele deixa de ser a unica leitura disponivel.
    expect(agente.getUsage().totalTokens).toBe(40);
    expect(agente.getUsage('thread-a').totalTokens).toBe(20);
  });

  it('clearHistory apaga o historico da thread de verdade', async () => {
    const agente = criarAgente();

    agente.clearHistory('thread-a');

    expect(agente.getHistory('thread-a')).toEqual([]);
  });
});
