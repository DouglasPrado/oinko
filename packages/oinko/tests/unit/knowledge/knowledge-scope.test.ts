import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KnowledgeManager } from '../../../src/knowledge/knowledge-manager.js';
import { SQLiteVectorStore } from '../../../src/knowledge/sqlite-vector-store.js';
import { SQLiteDatabase } from '../../../src/storage/sqlite-database.js';
import type { EmbeddingService } from '../../../src/knowledge/embedding-service.js';

/**
 * O acervo de RAG e compartilhado por escopo, e nao pelo processo.
 *
 * Achado 1.1 da auditoria: `KnowledgeManager.search` nao aceitava recorte
 * nenhum, entao um `/learn` numa conversa do Teams virava contexto de todas as
 * outras — todos os agentes do pool apontam para o mesmo `dbPath`, logo para a
 * mesma tabela de vetores. Estes testes fixam o contrato do recorte.
 */

/**
 * Embedding deterministico por contagem de letras.
 *
 * Um embedding constante faria dois textos diferentes terem o mesmo vetor: a
 * busca devolveria qualquer coisa com score 1 e o teste passaria sem provar
 * nada. Contando letras, textos diferentes ganham direcoes diferentes.
 */
const vetorDe = (texto: string): number[] => {
  const vetor = new Array<number>(26).fill(0);
  for (const caractere of texto.toLowerCase()) {
    const indice = caractere.charCodeAt(0) - 97;
    if (indice >= 0 && indice < 26) vetor[indice]! += 1;
  }
  const norma = Math.hypot(...vetor) || 1;
  return vetor.map((valor) => valor / norma);
};

const embeddingFake = {
  embed: async (textos: string[]) => textos.map(vetorDe),
  embedSingle: async (texto: string) => new Float32Array(vetorDe(texto)),
} as unknown as EmbeddingService;

describe('KnowledgeManager — recorte por escopo', () => {
  let database: SQLiteDatabase;
  let manager: KnowledgeManager;

  beforeEach(() => {
    database = new SQLiteDatabase(':memory:');
    database.initialize();
    manager = new KnowledgeManager({
      store: new SQLiteVectorStore(database),
      embeddingService: embeddingFake,
      chunkSize: 200,
      chunkOverlap: 0,
      minScore: 0,
    });
  });

  afterEach(() => {
    database.close();
  });

  it('nao devolve documento ingerido em outro escopo', async () => {
    await manager.ingest({ content: 'contrato confidencial da conversa A' }, 'conversa-a');

    const achado = await manager.search('contrato confidencial', 'conversa-b');

    expect(achado).toEqual([]);
  });

  it('devolve o documento no MESMO escopo em que foi ingerido', async () => {
    await manager.ingest({ content: 'contrato confidencial da conversa A' }, 'conversa-a');

    const achado = await manager.search('contrato confidencial', 'conversa-a');

    expect(achado.length).toBeGreaterThan(0);
    expect(achado[0]!.content).toContain('confidencial');
  });

  it('separa escopos que ingeriram conteudo diferente', async () => {
    await manager.ingest({ content: 'o segredo da conversa A e alfa' }, 'conversa-a');
    await manager.ingest({ content: 'o segredo da conversa B e beta' }, 'conversa-b');

    const deA = await manager.search('segredo', 'conversa-a');
    const deB = await manager.search('segredo', 'conversa-b');

    expect(deA.length).toBeGreaterThan(0);
    expect(deB.length).toBeGreaterThan(0);
    expect(deA.every((resultado) => resultado.content.includes('alfa'))).toBe(true);
    expect(deB.every((resultado) => resultado.content.includes('beta'))).toBe(true);
  });

  /**
   * O cache era chaveado so pela query. Sem o escopo na chave, a primeira
   * conversa a perguntar algo entregaria a resposta dela a todas as seguintes —
   * um segundo caminho de vazamento, que filtrar no SQL sozinho nao fecha.
   */
  it('nao serve resultado de um escopo pelo cache de outro', async () => {
    await manager.ingest({ content: 'o segredo da conversa A e alfa' }, 'conversa-a');

    const primeira = await manager.search('segredo', 'conversa-a');
    const segunda = await manager.search('segredo', 'conversa-b');

    expect(primeira.length).toBeGreaterThan(0);
    expect(segunda).toEqual([]);
  });

  it('recusa escopo vazio', async () => {
    await expect(manager.ingest({ content: 'qualquer coisa' }, '')).rejects.toThrow(/scope/i);
    await expect(manager.search('qualquer coisa', '')).rejects.toThrow(/scope/i);
  });

  it('recusa escopo com caractere de controle', async () => {
    const comControle = `conversa${String.fromCharCode(0)}a`;

    await expect(manager.search('qualquer coisa', comControle)).rejects.toThrow(/scope/i);
  });
});
