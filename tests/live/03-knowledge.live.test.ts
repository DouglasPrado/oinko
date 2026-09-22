import { describe, it, expect } from 'vitest';
import { createLiveAgent, hasJev, hasLLM, pointsOf } from './helpers.js';

const POLITICA =
  'Politica de reembolso da Acme: o cliente pode pedir reembolso integral em ate 30 dias corridos apos a compra. Apos esse prazo, o reembolso e proporcional ao tempo restante do plano.';
const FERIAS =
  'Politica de ferias da Acme: cada colaborador tem 30 dias por ano, que podem ser divididos em ate tres periodos.';

describe.skipIf(!hasLLM)('knowledge: RAG com recorte por conversa', () => {
  it('ingere um documento e responde com base nele', async () => {
    const { agent, dispose } = createLiveAgent(
      { knowledge: { enabled: true } },
      { withDecider: false },
    );
    try {
      await agent.ingestKnowledge({ content: POLITICA }, 'suporte');

      const achados = await agent.searchKnowledge('prazo de reembolso', 'suporte');
      expect(achados.length).toBeGreaterThan(0);
      expect(achados[0]!.content).toContain('30 dias');

      const reply = await agent.chat('Qual o prazo para pedir reembolso integral?', {
        threadId: 'suporte',
      });
      expect(reply).toMatch(/30/);
    } finally {
      await dispose();
    }
  });

  it('documento de uma conversa nao vaza para outra', async () => {
    const { agent, dispose } = createLiveAgent(
      { knowledge: { enabled: true } },
      { withDecider: false },
    );
    try {
      await agent.ingestKnowledge({ content: POLITICA }, 'conversa-a');

      expect((await agent.searchKnowledge('reembolso', 'conversa-a')).length).toBeGreaterThan(0);
      expect(await agent.searchKnowledge('reembolso', 'conversa-b')).toEqual([]);
    } finally {
      await dispose();
    }
  });

  it('le o acervo compartilhado junto com o da conversa', async () => {
    const { agent, dispose } = createLiveAgent(
      { knowledge: { enabled: true } },
      { withDecider: false },
    );
    try {
      await agent.ingestKnowledge({ content: FERIAS }, 'rh-compartilhado');
      await agent.ingestKnowledge({ content: POLITICA }, 'conversa-a');

      const so = await agent.searchKnowledge('ferias', 'conversa-a');
      expect(so).toEqual([]);

      const ambos = await agent.searchKnowledge('ferias', ['conversa-a', 'rh-compartilhado']);
      expect(ambos.length).toBeGreaterThan(0);
      expect(ambos[0]!.content).toContain('30 dias por ano');
    } finally {
      await dispose();
    }
  });

  it('recusa escopo vazio em vez de buscar em tudo', async () => {
    const { agent, dispose } = createLiveAgent(
      { knowledge: { enabled: true } },
      { withDecider: false },
    );
    try {
      await expect(agent.searchKnowledge('qualquer coisa', '')).rejects.toThrow(/scope/i);
    } finally {
      await dispose();
    }
  });
});

describe.skipIf(!hasLLM || !hasJev)('knowledge: gate e rerank decididos pelo Jev', () => {
  it('pula a busca num turno que nao precisa dela', async () => {
    const { agent, decisions, dispose } = createLiveAgent({ knowledge: { enabled: true } });
    try {
      await agent.ingestKnowledge({ content: POLITICA }, 'gate');
      const antes = decisions.length;

      await agent.chat('ok, obrigado!', { threadId: 'gate' });

      const gates = decisions.slice(antes).filter((d) => d.point === 'knowledge_gate');
      expect(gates.length).toBeGreaterThan(0);
      // Turno trivial: o veredito deve ser "nao precisa".
      expect(gates.at(-1)!.answers.needsKnowledge!.value).toBe(false);
    } finally {
      await dispose();
    }
  });

  it('busca e rerankeia num turno que precisa', async () => {
    const { agent, decisions, dispose } = createLiveAgent({ knowledge: { enabled: true } });
    try {
      await agent.ingestKnowledge({ content: POLITICA }, 'rag');
      await agent.ingestKnowledge({ content: FERIAS }, 'rag');
      const antes = decisions.length;

      const reply = await agent.chat('Qual o prazo de reembolso integral?', { threadId: 'rag' });

      const pontos = pointsOf(decisions.slice(antes));
      expect(pontos).toContain('knowledge_gate');
      expect(pontos).toContain('knowledge_rerank');
      expect(reply).toMatch(/30/);
    } finally {
      await dispose();
    }
  });
});
