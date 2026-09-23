import type { ChatMessage } from '../contracts/entities/chat-message.js';
import type { ConversationStore } from '../contracts/entities/stores.js';

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
}
