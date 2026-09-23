import type { ChatMessage } from '../contracts/entities/chat-message.js';
import type { ConversationStore } from '../contracts/entities/stores.js';
import type {
  ConversationSearchPage,
  ConversationSearchQuery,
  ConversationSearchRole,
} from '../contracts/entities/conversation-search.js';
import { foldText, searchableText } from '../utils/conversation-text.js';
import { excerptAround } from '../utils/excerpt.js';

/**
 * In-memory fallback ConversationStore.
 */
class InMemoryConversationStore implements ConversationStore {
  private readonly threads = new Map<string, ChatMessage[]>();

  appendMessage(message: ChatMessage, threadId: string): void {
    if (!this.threads.has(threadId)) this.threads.set(threadId, []);
    this.threads.get(threadId)!.push(message);
  }

  listThread(threadId: string): ChatMessage[] {
    return this.threads.get(threadId) ?? [];
  }

  listPinned(threadId: string): ChatMessage[] {
    return this.listThread(threadId).filter((m) => m.pinned);
  }

  clearThread(threadId: string): void {
    this.threads.delete(threadId);
  }

  /** Linear scan — fine for the in-process fallback, which holds one process's threads. */
  searchMessages(
    query: ConversationSearchQuery,
    threadIds: readonly string[],
  ): ConversationSearchPage {
    const allowed = new Set(threadIds);
    const terms = query.terms.map(foldText).filter((t) => /[\p{L}\p{N}]/u.test(t));
    // Terms were given but none is a word: nothing can match (same as SQLite).
    if (query.terms.length > 0 && terms.length === 0) return { hits: [], hasMore: false };
    const found: {
      threadId: string;
      role: ConversationSearchRole;
      createdAt: number;
      text: string;
      matched: number;
    }[] = [];

    for (const [threadId, messages] of this.threads) {
      if (!allowed.has(threadId)) continue;
      for (const m of messages) {
        const role = m.role as ConversationSearchRole;
        if (!query.roles.includes(role)) continue;
        if (query.after !== undefined && m.createdAt < query.after) continue;
        if (query.before !== undefined && m.createdAt >= query.before) continue;
        const text = searchableText(m.role, m.content);
        if (text === '') continue;
        const folded = foldText(text);
        const matched = terms.filter((t) => folded.includes(t)).length;
        if (terms.length > 0 && (query.match === 'all' ? matched < terms.length : matched === 0)) {
          continue;
        }
        found.push({ threadId, role, createdAt: m.createdAt, text, matched });
      }
    }

    found.sort((a, b) => b.matched - a.matched || b.createdAt - a.createdAt);
    const page = found.slice(query.offset, query.offset + query.limit);
    return {
      hits: page.map((f) => ({
        threadId: f.threadId,
        role: f.role,
        createdAt: f.createdAt,
        snippet: excerptAround(f.text, terms, query.snippetChars),
      })),
      hasMore: found.length > query.offset + query.limit,
    };
  }
}

/**
 * Manages conversation threads with mutex for isolation.
 */
export class ConversationManager {
  private readonly store: ConversationStore;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(store?: ConversationStore) {
    this.store = store ?? new InMemoryConversationStore();
  }

  /**
   * Acquires mutex for a thread, executes fn, then releases.
   */
  async withThread<T>(threadId: string, fn: () => T | Promise<T>): Promise<T> {
    const release = await this.acquire(threadId);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Takes the thread lock and hands back the release.
   *
   * `withThread` cannot wrap a generator: the turn yields events to the caller
   * and only finishes when the caller stops iterating. Holding the lock across
   * that requires acquiring and releasing by hand, in a `finally`.
   */
  async acquire(threadId: string): Promise<() => void> {
    while (this.locks.has(threadId)) {
      await this.locks.get(threadId);
    }

    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.locks.set(threadId, lockPromise);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.locks.delete(threadId);
      releaseLock();
    };
  }

  appendMessage(message: ChatMessage, threadId: string): void {
    this.store.appendMessage(message, threadId);
  }

  getHistory(threadId: string): ChatMessage[] {
    return this.store.listThread(threadId);
  }

  getPinnedMessages(threadId: string): ChatMessage[] {
    return this.store.listPinned(threadId);
  }

  clearThread(threadId: string): void {
    this.store.clearThread(threadId);
  }

  /** Whether the store can answer {@link search}. */
  supportsSearch(): boolean {
    return typeof this.store.searchMessages === 'function';
  }

  search(query: ConversationSearchQuery, threadIds: readonly string[]): ConversationSearchPage {
    if (!this.store.searchMessages) {
      throw new Error('This ConversationStore does not implement searchMessages()');
    }
    return this.store.searchMessages(query, threadIds);
  }
}
