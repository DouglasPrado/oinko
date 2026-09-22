import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createLiveAgent, digitsOf, hasLLM, pointsOf } from './helpers.js';
import type { AgentEvent } from '../../src/index.js';

describe.skipIf(!hasLLM)('conversa: o basico que todo consumidor usa', () => {
  it('responde uma pergunta direta', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      const reply = await agent.chat('Responda apenas: qual a capital da Franca?', {
        threadId: 't1',
      });
      expect(reply.toLowerCase()).toContain('paris');
    } finally {
      await dispose();
    }
  });

  it('entrega a resposta em pedacos pelo stream, nao so no fim', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      const events: AgentEvent[] = [];
      for await (const e of agent.stream('Conte ate cinco, um numero por linha.', {
        threadId: 't1',
      })) {
        events.push(e);
      }

      const deltas = events.filter((e) => e.type === 'text_delta');
      expect(deltas.length).toBeGreaterThan(1);
      expect(events.at(0)?.type).toBe('agent_start');
      expect(events.at(-1)?.type).toBe('agent_end');
    } finally {
      await dispose();
    }
  });

  it('lembra do que foi dito antes na mesma thread', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      await agent.chat('Meu numero favorito e 42. Apenas confirme.', { threadId: 'mesma' });
      const reply = await agent.chat('Qual e o meu numero favorito?', { threadId: 'mesma' });
      expect(digitsOf(reply)).toContain('42');
    } finally {
      await dispose();
    }
  });

  it('nao enxerga a conversa de outra thread', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      await agent.chat('Meu numero favorito e 42. Apenas confirme.', { threadId: 'thread-a' });
      const reply = await agent.chat(
        'Qual e o meu numero favorito? Se voce nao sabe, diga exatamente NAO SEI.',
        { threadId: 'thread-b' },
      );
      expect(reply.toUpperCase()).toContain('NAO SEI');
    } finally {
      await dispose();
    }
  });

  it('chama uma tool e usa o resultado na resposta', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    let chamou = false;
    agent.addTool({
      name: 'get_order_count',
      description: 'Retorna quantos pedidos a loja teve ontem.',
      parameters: z.object({}),
      execute: () => {
        chamou = true;
        return Promise.resolve('1847');
      },
    });

    try {
      const reply = await agent.chat('Quantos pedidos tivemos ontem?', { threadId: 't1' });
      expect(chamou).toBe(true);
      expect(digitsOf(reply)).toContain('1847');
    } finally {
      await dispose();
    }
  });

  it('contabiliza consumo por thread e nao vaza para outra', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      await agent.chat('Diga apenas: ok', { threadId: 'usada' });

      expect(agent.getUsage('usada').totalTokens).toBeGreaterThan(0);
      expect(agent.getUsage('nunca-usada').totalTokens).toBe(0);
      expect(agent.getUsage().totalTokens).toBeGreaterThanOrEqual(
        agent.getUsage('usada').totalTokens,
      );
    } finally {
      await dispose();
    }
  });

  it('sem decisor configurado, nenhuma decisao e tomada', async () => {
    const { agent, decisions, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      await agent.chat('Diga apenas: ok', { threadId: 't1' });
      expect(pointsOf(decisions)).toEqual([]);
    } finally {
      await dispose();
    }
  });
});
