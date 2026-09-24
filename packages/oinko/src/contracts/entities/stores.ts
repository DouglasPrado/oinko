import type { ChatMessage } from './chat-message.js';
import type { KnowledgeChunk, RetrievedKnowledge } from './knowledge.js';
import type { ConversationSearchPage, ConversationSearchQuery } from './conversation-search.js';
import type { ConversationCheckpoint, ArchivedToolResult } from './working-context.js';

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
  getCheckpoint?(threadId: string): ConversationCheckpoint | undefined;
  saveCheckpoint?(threadId: string, checkpoint: ConversationCheckpoint): void;
  getToolResult?(threadId: string, id: string): ArchivedToolResult | undefined;
  saveToolResult?(threadId: string, result: ArchivedToolResult): void;
  /**
   * Optional. Searches past messages inside `threadIds` and nowhere else; an
   * empty list returns an empty page. Only user and assistant text is
   * searchable. Required when `conversation.search` is enabled.
   */
  searchMessages?(
    query: ConversationSearchQuery,
    threadIds: readonly string[],
  ): ConversationSearchPage;
}
