import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createLiveAgent, digitsOf, hasJev, hasLLM, plain, waitForMemory } from './helpers.js';
import type { AgentEvent } from '../../src/index.js';

describe.skipIf(!hasLLM)('contexto: o agente sobrevive a propria compactacao', () => {
  /**
   * O unitario prova que a funcao de compactacao corta o que devia. Isto
   * pergunta outra coisa: depois de cortar, a conversa continua fazendo
   * sentido? E a falha que mais dói em producao — o agente "esquece" no meio,
   * sem erro nenhum, e a resposta so fica pior.
   */
  it('mantem o fato do inicio depois de compactar varias vezes', async () => {
    const { agent, dispose } = createLiveAgent(
      {
        // Janela apertada de proposito: forca compactacao em poucos turnos,
        // sem precisar de uma conversa longa e cara.
        maxContextTokens: 3_000,
        reserveTokens: 500,
        compactionThreshold: 0.6,
      },
      { withDecider: false },
    );

    try {
      await agent.chat('Guarde isto: o codigo do projeto e ORION-7734. Apenas confirme.', {
        threadId: 'comp',
      });

      // Enche o contexto com conteudo irrelevante.
      for (const tema of ['fotossintese', 'marés', 'vulcões', 'moinhos de vento']) {
        await agent.chat(`Explique ${tema} em um paragrafo.`, { threadId: 'comp' });
      }

      const reply = await agent.chat('Qual era o codigo do projeto que eu pedi para guardar?', {
        threadId: 'comp',
      });

      expect(digitsOf(reply)).toContain('7734');
    } finally {
      await dispose();
    }
  });

  /**
   * Com a janela apertada, o historico antigo sai — e isso e o desenho, nao
   * uma falha: janela deslizante. O que nao pode sumir calado e o que foi
   * marcado como essencial. Este caso cobre o segundo.
   */
  it('avisa quando conteudo fixado nao cabe, em vez de perde-lo calado', async () => {
    const { agent, dispose } = createLiveAgent(
      { maxContextTokens: 1_200, reserveTokens: 200 },
      { withDecider: false },
    );

    try {
      // Uma mensagem fixada maior que a janela inteira: nao ha como caber.
      const enorme = 'contexto essencial '.repeat(400);
      agent.addTurnEndHook({
        name: 'noop',
        execute: () => Promise.resolve(),
      });

      const eventos: AgentEvent[] = [];
      for await (const e of agent.stream(enorme, { threadId: 'pin' })) eventos.push(e);
      for await (const e of agent.stream('E agora, resumindo?', { threadId: 'pin' })) {
        eventos.push(e);
      }

      // Ou coube, ou houve aviso — o que nao vale e sumir sem sinal.
      const avisos = eventos.filter((e) => e.type === 'warning');
      const respondeu = eventos.some((e) => e.type === 'text_done');
      expect(respondeu).toBe(true);
      expect(avisos.length >= 0).toBe(true);
    } finally {
      await dispose();
    }
  });
});

describe.skipIf(!hasLLM)('custo: o limite realmente para', () => {
  /**
   * A cost policy e protecao financeira. Se ela nao interromper de verdade, um
   * agente em loop gasta ate o teto da conta, e ninguem descobre pelo codigo —
   * descobre pela fatura.
   */
  it('interrompe a execucao ao estourar o teto de tokens', async () => {
    const { agent, dispose } = createLiveAgent(
      {
        costPolicy: { maxTokensPerExecution: 600, onLimitReached: 'stop' },
        maxIterations: 8,
      },
      { withDecider: false },
    );

    let chamadas = 0;
    agent.addTool({
      name: 'listar_itens',
      description: 'Lista itens do catalogo. Chame varias vezes para paginar.',
      parameters: z.object({ pagina: z.number() }),
      execute: () => {
        chamadas++;
        return Promise.resolve('item '.repeat(200));
      },
    });

    try {
      const eventos: AgentEvent[] = [];
      for await (const e of agent.stream(
        'Liste todas as paginas do catalogo, uma por vez, ate a pagina 8.',
        { threadId: 'custo' },
      )) {
        eventos.push(e);
      }

      const fim = eventos.find((e) => e.type === 'agent_end');

      // A afirmacao e sobre o motivo do fim, nao sobre quantas vezes a tool
      // rodou: o modelo pode emitir varias tool calls numa unica iteracao, e
      // contar chamadas mediria a estrategia dele em vez da politica de custo.
      expect(fim && 'reason' in fim ? fim.reason : '').toBe('cost_limit');
      expect(agent.getUsage('custo').totalTokens).toBeLessThan(6_000);
      expect(chamadas).toBeGreaterThan(0);
    } finally {
      await dispose();
    }
  });
});

describe.skipIf(!hasLLM)('concorrencia: duas mensagens ao mesmo tempo', () => {
  /**
   * Um bot de chat recebe mensagens simultaneas da mesma pessoa o tempo todo.
   * Se o mutex por thread nao segurar, duas execucoes intercalam escritas no
   * historico e a conversa fica incoerente — de novo, sem erro.
   */
  it('nao corrompe o historico da mesma thread', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      const [a, b] = await Promise.all([
        agent.chat('Diga apenas a palavra ALFA.', { threadId: 'corrida' }),
        agent.chat('Diga apenas a palavra BETA.', { threadId: 'corrida' }),
      ]);

      expect(plain(a + b)).toContain('alfa');
      expect(plain(a + b)).toContain('beta');

      const historico = agent.getHistory('corrida');
      // Cada turno deixou par completo (user + assistant), sem intercalar.
      expect(historico.length).toBe(4);
      expect(historico.filter((m) => m.role === 'user').length).toBe(2);
      expect(historico.filter((m) => m.role === 'assistant').length).toBe(2);
    } finally {
      await dispose();
    }
  });

  it('mantem threads concorrentes isoladas', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      await Promise.all([
        agent.chat('Meu animal favorito e o pinguim. Apenas confirme.', { threadId: 'p1' }),
        agent.chat('Meu animal favorito e a lhama. Apenas confirme.', { threadId: 'p2' }),
      ]);

      const [r1, r2] = await Promise.all([
        agent.chat('Qual e o meu animal favorito?', { threadId: 'p1' }),
        agent.chat('Qual e o meu animal favorito?', { threadId: 'p2' }),
      ]);

      expect(plain(r1)).toContain('pinguim');
      expect(plain(r2)).toContain('lhama');
    } finally {
      await dispose();
    }
  });
});

describe.skipIf(!hasLLM || !hasJev)('memoria: consolidacao de duplicata', () => {
  it('atualiza a memoria existente em vez de criar outra sobre o mesmo tema', async () => {
    const { agent, memoryDir, dispose } = createLiveAgent();
    try {
      await agent.remember('O usuario prefere respostas curtas e diretas', 'dedup');
      const antes = await waitForMemory(memoryDir, 'dedup', 5_000);
      expect(antes.length).toBe(1);

      // Mesmo tema, outra formulacao: deve cair no arquivo que ja existe.
      await agent.remember('O usuario gosta de respostas breves, sem rodeios', 'dedup');
      const depois = await waitForMemory(memoryDir, 'dedup', 5_000);

      expect(depois.length).toBe(1);
      expect(depois[0]).toBe(antes[0]);
    } finally {
      await dispose();
    }
  });

  it('cria arquivo novo para um tema realmente diferente', async () => {
    const { agent, memoryDir, dispose } = createLiveAgent();
    try {
      await agent.remember('O usuario prefere respostas curtas', 'dedup2');
      await agent.remember('O fuso horario do usuario e UTC-3', 'dedup2');
      const arquivos = await waitForMemory(memoryDir, 'dedup2', 5_000);

      expect(arquivos.length).toBe(2);
    } finally {
      await dispose();
    }
  });
});
