import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileMemorySystem } from '../../../src/memory/file-memory-system.js';
import { createLogger } from '../../../src/utils/logger.js';

/**
 * Memoria salva por uma pessoa nao pode virar contexto de outra.
 *
 * Achado 1.2 da auditoria: `agent.remember(text)` sem o terceiro argumento cai
 * na raiz do `memoryDir`, e `scanMemories` mescla a raiz em TODA thread — entao
 * o `/memory` de um chat aparecia no contexto de todos os outros. O sistema de
 * arquivos ja sabia recortar; era a chamada que nao pedia recorte.
 *
 * Estes testes fixam o comportamento do FileMemorySystem, que e o que a
 * correcao no `Agent` e nos bots passa a usar.
 */
describe('FileMemorySystem — recorte por thread', () => {
  let raiz: string;
  let sistema: FileMemorySystem;

  beforeEach(async () => {
    raiz = mkdtempSync(join(tmpdir(), 'harness-memoria-'));
    sistema = new FileMemorySystem(
      { memoryDir: raiz, extractionEnabled: false },
      // O cliente de LLM so e usado na selecao por relevancia, que estes testes
      // nao exercitam: scanMemories e leitura de diretorio, nao inferencia.
      null as never,
      createLogger('silent'),
    );
    await sistema.ensureDir();
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('memoria de uma thread nao aparece na varredura de outra', async () => {
    await sistema.saveMemory(
      {
        name: 'preferencia',
        description: 'preferencia da pessoa A',
        type: 'user',
        content: 'a pessoa A prefere respostas curtas',
      },
      'thread-a',
    );

    const daOutra = await sistema.scanMemories(undefined, 'thread-b');

    expect(daOutra).toEqual([]);
  });

  it('memoria da thread aparece na varredura da PROPRIA thread', async () => {
    await sistema.saveMemory(
      {
        name: 'preferencia',
        description: 'preferencia da pessoa A',
        type: 'user',
        content: 'a pessoa A prefere respostas curtas',
      },
      'thread-a',
    );

    const daPropria = await sistema.scanMemories(undefined, 'thread-a');

    expect(daPropria.length).toBe(1);
    expect(daPropria[0]!.description).toContain('pessoa A');
  });

  /**
   * O acervo global continua existindo e continua sendo mesclado em toda
   * thread. Isso e desenho, nao defeito — o que a auditoria condena e cair nele
   * por esquecimento, e nao a existencia dele. Depois da correcao, escrever no
   * global exige dize-lo.
   */
  it('memoria global continua visivel de qualquer thread', async () => {
    await sistema.saveMemory({
      name: 'politica',
      description: 'politica da instalacao',
      type: 'project',
      content: 'responder sempre em portugues',
    });

    const daThread = await sistema.scanMemories(undefined, 'thread-a');

    expect(daThread.length).toBe(1);
    expect(daThread[0]!.description).toContain('politica');
  });
});
