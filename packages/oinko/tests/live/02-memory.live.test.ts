import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLiveAgent, hasJev, hasLLM, pointsOf, settle, waitForMemory } from './helpers.js';

function memoriesOf(memoryDir: string, threadId?: string): string[] {
  const dir = threadId ? join(memoryDir, 'threads', threadId) : memoryDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
}

function contentOf(memoryDir: string, threadId: string): string {
  const dir = join(memoryDir, 'threads', threadId);
  return memoriesOf(memoryDir, threadId)
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

describe.skipIf(!hasLLM)('memoria: o que o agente guarda e o que ele enxerga', () => {
  it('escreve e le uma memoria explicitamente', async () => {
    const { agent, memoryDir, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      const filename = await agent.remember('O usuario prefere respostas curtas', 'thread-x');
      expect(filename).toMatch(/\.md$/);

      const recalled = await agent.recall('preferencias', 'thread-x');
      expect(recalled.length).toBeGreaterThan(0);
      expect(memoriesOf(memoryDir, 'thread-x').length).toBeGreaterThan(0);
    } finally {
      await dispose();
    }
  });

  it('memoria de uma thread nao aparece em outra', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      await agent.remember('O CNPJ da empresa e 11.222.333/0001-44', 'thread-a');

      expect((await agent.recall('CNPJ', 'thread-a')).length).toBeGreaterThan(0);
      expect(await agent.recall('CNPJ', 'thread-b')).toEqual([]);
    } finally {
      await dispose();
    }
  });

  it('memoria global e visivel de qualquer thread', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      await agent.rememberGlobal('Responder sempre em portugues do Brasil', 'project');
      expect((await agent.recall('idioma', 'qualquer-thread')).length).toBeGreaterThan(0);
    } finally {
      await dispose();
    }
  });

  it('usa na conversa uma memoria gravada antes', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      await agent.remember('O nome do cachorro do usuario e Bolinha', 'pets');
      const reply = await agent.chat('Como se chama o meu cachorro?', { threadId: 'pets' });
      expect(reply.toLowerCase()).toContain('bolinha');
    } finally {
      await dispose();
    }
  });
});

describe.skipIf(!hasLLM || !hasJev)('memoria: extracao decidida pelo Jev', () => {
  it('extrai quando o turno carrega um fato duravel', async () => {
    const { agent, decisions, memoryDir, dispose } = createLiveAgent({
      // Ambas as heuristicas desligadas: se algo for extraido, foi decisao.
      memory: { enabled: true, samplingRate: 0, extractionInterval: 9999 },
    });
    try {
      await agent.chat('Anote: eu trabalho como engenheiro de dados na Acme.', {
        threadId: 'fato',
      });
      const arquivos = await waitForMemory(memoryDir, 'fato');

      expect(pointsOf(decisions)).toContain('memory_extraction');
      expect(arquivos.length).toBeGreaterThan(0);
      expect(contentOf(memoryDir, 'fato').toLowerCase()).toMatch(/engenheiro|acme|dados/);
    } finally {
      await dispose();
    }
  });

  it('nao extrai de um turno sem nada duravel', async () => {
    const { agent, decisions, memoryDir, dispose } = createLiveAgent({
      memory: { enabled: true, samplingRate: 0, extractionInterval: 9999 },
    });
    try {
      await agent.chat('ok, obrigado!', { threadId: 'vazio' });
      await settle(8_000);

      const verdicts = decisions.filter((d) => d.point === 'memory_extraction');
      expect(verdicts.length).toBeGreaterThan(0);
      expect(memoriesOf(memoryDir, 'vazio')).toEqual([]);
    } finally {
      await dispose();
    }
  });

  it('enxerga o fato que so aparece na resposta do agente', async () => {
    const { agent, decisions, dispose } = createLiveAgent({
      memory: { enabled: true, samplingRate: 0, extractionInterval: 9999 },
    });
    try {
      await agent.chat(
        'Por que o deploy falhou? Responda: o deploy falhou porque a variavel DATABASE_URL nao esta definida em producao.',
        { threadId: 'diag' },
      );
      await settle();

      const verdict = decisions.find((d) => d.point === 'memory_extraction');
      expect(verdict).toBeDefined();
      // As duas perguntas viajam juntas: a pergunta sobre o lado do assistente existe.
      expect(Object.keys(verdict!.answers)).toContain('durableFromAssistant');
    } finally {
      await dispose();
    }
  });
});
