import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SQLiteDatabase } from '../../../src/storage/sqlite-database.js';
import { SQLiteConversationStore } from '../../../src/storage/sqlite-conversation-store.js';
import { ConversationManager } from '../../../src/core/conversation-manager.js';
import type { ChatMessage } from '../../../src/contracts/entities/chat-message.js';
import type { ConversationSearchQuery } from '../../../src/contracts/entities/conversation-search.js';
import type { Logger } from '../../../src/utils/logger.js';

const query = (overrides: Partial<ConversationSearchQuery> = {}): ConversationSearchQuery => ({
  terms: [],
  match: 'all',
  roles: ['user', 'assistant'],
  limit: 5,
  offset: 0,
  snippetChars: 240,
  ...overrides,
});

const at = (
  role: ChatMessage['role'],
  content: ChatMessage['content'],
  createdAt: number,
): ChatMessage => ({
  role,
  content,
  createdAt,
});

/**
 * Both stores answer the same questions the same way: the in-memory one is
 * what tests and store-less hosts get, so it must not quietly search wider.
 */
describe.each([
  [
    'sqlite',
    () => {
      const db = new SQLiteDatabase(':memory:');
      db.initialize();
      return {
        manager: new ConversationManager(new SQLiteConversationStore(db)),
        close: () => db.close(),
      };
    },
  ],
  ['memory', () => ({ manager: new ConversationManager(), close: () => {} })],
] as const)('conversation search (%s store)', (_name, make) => {
  let manager: ConversationManager;
  let close: () => void;

  beforeEach(() => {
    ({ manager, close } = make());
    manager.appendMessage(at('user', 'o script de deploy tem que rodar só na main', 1_000), 't1');
    manager.appendMessage(
      at('assistant', 'Sugiro que o script de deploy faça rollback', 2_000),
      't1',
    );
    manager.appendMessage(at('user', 'qual foi a decisão sobre o orçamento?', 3_000), 't1');
    manager.appendMessage(at('tool', 'deploy deploy deploy (página buscada)', 3_500), 't1');
    manager.appendMessage(at('user', 'segredo da outra pessoa: deploy', 4_000), 't2');
  });

  afterEach(() => close());

  it('supports search', () => {
    expect(manager.supportsSearch()).toBe(true);
  });

  it('never returns another thread', () => {
    const page = manager.search(query({ terms: ['deploy'] }), ['t1']);
    expect(page.hits.length).toBeGreaterThan(0);
    expect(page.hits.every((h) => h.threadId === 't1')).toBe(true);
  });

  it('returns nothing for an empty scope', () => {
    expect(manager.search(query({ terms: ['deploy'] }), []).hits).toEqual([]);
  });

  it('never indexes tool output', () => {
    const page = manager.search(query({ terms: ['buscada'] }), ['t1']);
    expect(page.hits).toEqual([]);
  });

  it('folds accents both ways', () => {
    expect(manager.search(query({ terms: ['decisao'] }), ['t1']).hits).toHaveLength(1);
    expect(manager.search(query({ terms: ['orçamento'] }), ['t1']).hits).toHaveLength(1);
  });

  it('matches all terms or any, as asked', () => {
    expect(manager.search(query({ terms: ['deploy', 'orçamento'] }), ['t1']).hits).toEqual([]);
    expect(
      manager.search(query({ terms: ['deploy', 'orçamento'], match: 'any' }), ['t1']).hits.length,
    ).toBe(3);
  });

  it('filters by speaker', () => {
    const page = manager.search(query({ terms: ['deploy'], roles: ['assistant'] }), ['t1']);
    expect(page.hits.map((h) => h.role)).toEqual(['assistant']);
  });

  it('filters by time window, after inclusive and before exclusive', () => {
    const page = manager.search(query({ terms: ['deploy'], after: 1_000, before: 2_000 }), ['t1']);
    expect(page.hits.map((h) => h.createdAt)).toEqual([1_000]);
  });

  it('lists recent messages newest first when no terms are given', () => {
    const page = manager.search(query({ limit: 2 }), ['t1']);
    expect(page.hits.map((h) => h.createdAt)).toEqual([3_000, 2_000]);
    expect(page.hasMore).toBe(true);
  });

  it('pages with offset', () => {
    const page = manager.search(query({ limit: 2, offset: 2 }), ['t1']);
    expect(page.hits.map((h) => h.createdAt)).toEqual([1_000]);
    expect(page.hasMore).toBe(false);
  });

  it('marks the match in a short excerpt', () => {
    const [hit] = manager.search(query({ terms: ['rollback'], snippetChars: 80 }), ['t1']).hits;
    expect(hit!.snippet).toContain('«rollback»');
    expect(hit!.snippet.length).toBeLessThanOrEqual(80 + 2);
  });

  it('treats query syntax as plain words', () => {
    for (const term of ['"', '*', 'NEAR(', 'col:', '-', '^', 'AND', 'OR']) {
      expect(() => manager.search(query({ terms: [term] }), ['t1'])).not.toThrow();
    }
  });

  it('finds nothing for terms that are only punctuation', () => {
    expect(manager.search(query({ terms: ['"', '*'] }), ['t1']).hits).toEqual([]);
  });

  it('forgets a cleared thread', () => {
    manager.clearThread('t1');
    expect(manager.search(query({ terms: ['deploy'] }), ['t1']).hits).toEqual([]);
  });
});

describe('SQLite conversation search — storage details', () => {
  let db: SQLiteDatabase;

  beforeEach(() => {
    db = new SQLiteDatabase(':memory:');
    db.initialize();
  });

  afterEach(() => db.close());

  it('keeps the message when indexing fails', () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
    const store = new SQLiteConversationStore(db, logger);
    db.db.exec('DROP TABLE conversations_fts');

    store.appendMessage(at('user', 'ainda gravada', 1), 't1');

    expect(store.listThread('t1')).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does not index an assistant turn that only issued tool calls', () => {
    const store = new SQLiteConversationStore(db);
    store.appendMessage(
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } }],
        createdAt: 1,
      },
      't1',
    );
    const count = db.db.prepare('SELECT count(*) AS n FROM conversations_fts').get() as {
      n: number;
    };
    expect(count.n).toBe(0);
  });

  it('empties the index when a thread is cleared', () => {
    const store = new SQLiteConversationStore(db);
    store.appendMessage(at('user', 'algo', 1), 't1');
    store.clearThread('t1');
    const count = db.db.prepare('SELECT count(*) AS n FROM conversations_fts').get() as {
      n: number;
    };
    expect(count.n).toBe(0);
  });
});

describe('ConversationManager with a store that cannot search', () => {
  it('says so instead of pretending', () => {
    const manager = new ConversationManager({
      appendMessage: () => {},
      listThread: () => [],
      listPinned: () => [],
      clearThread: () => {},
    });
    expect(manager.supportsSearch()).toBe(false);
  });
});
