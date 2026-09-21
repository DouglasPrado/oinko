import { randomUUID } from 'node:crypto';
import type { VectorStore } from '../contracts/entities/stores.js';
import type {
  KnowledgeDocument,
  KnowledgeChunk,
  RetrievedKnowledge,
} from '../contracts/entities/knowledge.js';
import type { EmbeddingService } from './embedding-service.js';
import { chunkText } from './chunking.js';
import { LRUCache } from '../utils/cache.js';
import { rerankChunks } from './rerank.js';
import type { Decider } from '../contracts/entities/decider.js';

export interface KnowledgeManagerConfig {
  store: VectorStore;
  embeddingService: EmbeddingService;
  chunkSize?: number;
  chunkOverlap?: number;
  topK?: number;
  minScore?: number;
  /** When set, retrieved chunks are reranked by judged relevance. */
  decider?: Decider;
  /** Minimum position on the relevance scale to keep a chunk. */
  minRelevance?: number;
}

/**
 * A scope must be a real, printable identifier.
 *
 * An empty scope would silently behave like "no recorte" and bring the leak
 * back; a control character can break out of log lines and storage keys.
 */
function assertScope(scope: string): void {
  if (scope.trim().length === 0) {
    throw new Error('A scope is required: knowledge is stored per conversation, never globally');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(scope)) {
    throw new Error('Invalid scope: control characters are not allowed');
  }
}

/** How many extra candidates to pull from the store when reranking. */
const RERANK_FETCH_MULTIPLIER = 3;

/**
 * Manages knowledge ingestion (chunking + embedding) and RAG search.
 */
export class KnowledgeManager {
  private readonly store: VectorStore;
  private readonly embeddingService: EmbeddingService;
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private readonly topK: number;
  private readonly minScore: number;
  private readonly decider?: Decider;
  private readonly minRelevance?: number;
  private readonly searchCache: LRUCache<string, RetrievedKnowledge[]>;

  constructor(config: KnowledgeManagerConfig) {
    this.store = config.store;
    this.embeddingService = config.embeddingService;
    this.chunkSize = config.chunkSize ?? 512;
    this.chunkOverlap = config.chunkOverlap ?? 64;
    this.topK = config.topK ?? 5;
    this.minScore = config.minScore ?? 0.3;
    this.decider = config.decider;
    this.minRelevance = config.minRelevance;
    this.searchCache = new LRUCache<string, RetrievedKnowledge[]>({ maxSize: 100, ttl: 300_000 });
  }

  /**
   * Ingests a document: chunks it, generates embeddings, and persists.
   */
  async ingest(document: KnowledgeDocument, scope: string): Promise<number> {
    assertScope(scope);

    const chunks = chunkText(document.content, {
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
    });

    if (chunks.length === 0) return 0;

    const embeddings = await this.embeddingService.embed(chunks);

    if (embeddings.length !== chunks.length) {
      const sid = document.metadata?.sourceId;
      const sourceId = typeof sid === 'string' ? sid : 'unknown';
      throw new Error(
        `EmbeddingService returned ${embeddings.length} embeddings for ${chunks.length} chunks` +
          ` (document: ${sourceId})`,
      );
    }

    const now = Date.now();
    const chunkObjs: KnowledgeChunk[] = chunks.map((content, i) => ({
      id: randomUUID(),
      content,
      embedding: new Float32Array(embeddings[i]!),
      scope,
      metadata: { ...document.metadata, chunkIndex: i, totalChunks: chunks.length },
      createdAt: now,
    }));

    // Prefer atomic batch insert when the store supports it — this makes the
    // operation all-or-nothing and avoids partial-state on mid-ingest errors.
    if (typeof this.store.upsertMany === 'function') {
      this.store.upsertMany(chunkObjs);
    } else {
      for (const chunk of chunkObjs) {
        this.store.upsert(chunk);
      }
    }

    this.searchCache.clear();

    return chunkObjs.length;
  }

  /**
   * Searches knowledge by semantic similarity.
   */
  /**
   * Searches one conversation's documents, optionally together with shared
   * collections — pass every scope the caller is entitled to read.
   */
  async search(query: string, scope: string | readonly string[]): Promise<RetrievedKnowledge[]> {
    const scopes = typeof scope === 'string' ? [scope] : [...scope];
    if (scopes.length === 0) {
      throw new Error('A scope is required: knowledge is stored per conversation, never globally');
    }
    for (const one of scopes) assertScope(one);

    // The cache key carries the scopes: keyed by query alone, the first
    // conversation to ask something would serve its answer to every other.
    const cacheKey = `${[...scopes].sort().join('\u0001')}\u0000${query}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached) return cached;

    const queryEmbedding = await this.embeddingService.embedSingle(query);

    // With a reranker, cast a wider net first: similarity picks the pool,
    // judged relevance picks the final topK out of it.
    const fetchK = this.decider ? this.topK * RERANK_FETCH_MULTIPLIER : this.topK;
    const candidates = this.store
      .search(queryEmbedding, fetchK, scopes)
      .filter((r) => r.score >= this.minScore);

    let results = candidates.slice(0, this.topK);

    if (this.decider && candidates.length > 0) {
      try {
        results = await rerankChunks(query, candidates, this.decider, {
          topK: this.topK,
          ...(this.minRelevance !== undefined && { minRelevance: this.minRelevance }),
        });
      } catch {
        // Rerank failed — keep the similarity order.
      }
    }

    this.searchCache.set(cacheKey, results);
    return results;
  }
}
