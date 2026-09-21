import type { ChatMessage } from './chat-message.js';
import type { KnowledgeChunk, RetrievedKnowledge } from './knowledge.js';

/** Pluggable interface for vector storage (knowledge/RAG) */
export interface VectorStore {
  upsert(chunk: KnowledgeChunk): void;
  /** Optional: batch insert in a single atomic transaction — avoids partial-state on error. */
  upsertMany?(chunks: KnowledgeChunk[]): void;
  /**
   * Searches inside the given scopes and nowhere else. Several scopes are
   * allowed so a conversation can read its own documents plus a shared
   * collection, without either becoming visible to everyone.
   */
  search(
    queryEmbedding: Float32Array,
    topK: number,
    scopes: readonly string[],
  ): RetrievedKnowledge[];
  delete(id: string): void;
  listAll(): KnowledgeChunk[];
  deleteBySource(sourceId: string): void;
}

/** Pluggable interface for conversation history persistence */
export interface ConversationStore {
  appendMessage(message: ChatMessage, threadId: string): void;
  listThread(threadId: string): ChatMessage[];
  listPinned(threadId: string): ChatMessage[];
  clearThread(threadId: string): void;
}
