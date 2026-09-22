import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createLiveAgent, hasJev, hasLLM, plain, pointsOf, settle } from './helpers.js';
import { JsonlSink, JevDecider, RecordingDecider } from '../../src/index.js';

describe.skipIf(!hasLLM)('skills: ativacao e uso', () => {
  it('ativa a skill certa e segue as instrucoes dela', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    agent.addSkill({
      name: 'resumo-executivo',
      description: 'Produz resumos executivos curtos para diretoria',
      whenToUse: 'Quando o usuario pede um resumo ou sumario executivo',
      instructions:
        'Ao responder, comece obrigatoriamente com a linha "RESUMO EXECUTIVO:" e use no maximo duas frases.',
    });

    try {
      const reply = await agent.chat(
        'Me da um resumo executivo sobre o que e computacao em nuvem.',
        { threadId: 'sk' },
      );
      expect(reply.toUpperCase()).toContain('RESUMO EXECUTIVO');
    } finally {
      await dispose();
    }
  });

  it('nao ativa skill quando o assunto nao tem relacao', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    agent.addSkill({
      name: 'deploy',
      description: 'Conduz o processo de deploy em producao',
      whenToUse: 'Quando o usuario quer publicar uma versao',
      instructions: 'Comece a resposta com "DEPLOY:".',
    });

    try {
      const reply = await agent.chat('Qual a capital do Japao? Responda so o nome.', {
        threadId: 'sk2',
      });
      expect(reply.toUpperCase()).not.toContain('DEPLOY:');
      expect(plain(reply)).toContain('toquio');
    } finally {
      await dispose();
    }
  });
});

describe.skipIf(!hasLLM || !hasJev)('instrumentacao: o log que sustenta a medicao', () => {
  it('grava cada decisao em disco, sem o conteudo do usuario', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-log-'));
    const logPath = join(dir, 'decisions.jsonl');
    const sink = new JsonlSink(logPath, { maxBuffer: 1 });

    const { agent, dispose } = createLiveAgent({
      decider: new RecordingDecider(
        new JevDecider({ apiKey: process.env.TYPESAFE_API_KEY! }),
        (r) => sink.write(r),
      ),
    });

    try {
      await agent.chat('Meu email e segredo@exemplo.com, apenas confirme.', { threadId: 'log' });
      // O gate de extracao decide em background: chat() retorna antes dele.
      // Fechar o log aqui capturaria um arquivo vazio e diria que a
      // instrumentacao nao funciona, quando so chegou cedo demais.
      await settle(12_000);
      await sink.close();

      expect(existsSync(logPath)).toBe(true);
      const conteudo = readFileSync(logPath, 'utf8');
      expect(conteudo.trim().length).toBeGreaterThan(0);

      // O digest entra; o texto do usuario, nunca.
      expect(conteudo).not.toContain('segredo@exemplo.com');
      const primeira = JSON.parse(conteudo.trim().split('\n')[0]!) as Record<string, unknown>;
      expect(primeira.point).toBeTruthy();
      expect(primeira.stateHash).toBeTruthy();
      expect(primeira.state).toBeUndefined();
    } finally {
      await dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('todo ponto acionado tem nome — nenhum cai em unknown', async () => {
    const { agent, decisions, dispose } = createLiveAgent({
      knowledge: { enabled: true },
      jailbreak: { mode: 'warn' },
    });
    agent.addSkill({
      name: 'suporte',
      description: 'Ajuda com duvidas de produto',
      whenToUse: 'Duvidas sobre o produto',
      instructions: 'Seja objetivo.',
    });

    try {
      await agent.ingestKnowledge({ content: 'O plano Pro custa R$ 99 por mes.' }, 'inst');
      await agent.chat('Quanto custa o plano Pro?', { threadId: 'inst' });
      await settle(12_000);

      expect(decisions.length).toBeGreaterThan(0);
      expect(pointsOf(decisions)).not.toContain('unknown');
    } finally {
      await dispose();
    }
  });
});

describe.skipIf(!hasLLM)('persistencia: o que sobrevive ao restart', () => {
  it('outra instancia le a conversa gravada pela anterior', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-persist-'));
    const dbPath = join(dir, 'shared.db');
    const memoryDir = join(dir, 'memory') + '/';

    const primeira = createLiveAgent(
      { dbPath, knowledge: { enabled: true }, memory: { memoryDir } },
      { withDecider: false },
    );
    try {
      await primeira.agent.chat('Meu codigo de cliente e ZX-9981. Apenas confirme.', {
        threadId: 'persist',
      });
      expect(primeira.agent.getHistory('persist').length).toBeGreaterThan(0);
    } finally {
      await primeira.agent.destroy();
    }

    const segunda = createLiveAgent(
      { dbPath, knowledge: { enabled: true }, memory: { memoryDir } },
      { withDecider: false },
    );
    try {
      const historico = segunda.agent.getHistory('persist');
      expect(historico.length).toBeGreaterThan(0);

      const reply = await segunda.agent.chat('Qual e o meu codigo de cliente?', {
        threadId: 'persist',
      });
      expect(reply).toContain('ZX-9981');
    } finally {
      await segunda.agent.destroy();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
