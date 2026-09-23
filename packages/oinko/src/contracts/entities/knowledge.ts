/** A document to be ingested for RAG */
export interface KnowledgeDocument {
  content: string;
  metadata?: Record<string, unknown>;
}

/** A chunk of a document with its embedding */
export interface KnowledgeChunk {
  id: string;
  content: string;
  embedding: Float32Array;
  /**
   * Which conversation this chunk belongs to. The store is shared by the
   * process, so without it one conversation's documents become every other
   * conversation's context.
   */
  scope: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

/** A knowledge chunk retrieved by similarity search */
export interface RetrievedKnowledge {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}
