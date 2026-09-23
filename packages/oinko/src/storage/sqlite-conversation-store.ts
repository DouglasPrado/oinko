import type { ConversationStore } from '../contracts/entities/stores.js';
import type { ChatMessage } from '../contracts/entities/chat-message.js';
import type {
  ConversationSearchPage,
  ConversationSearchQuery,
  ConversationSearchRole,
} from '../contracts/entities/conversation-search.js';
import type { SQLiteDatabase } from './sqlite-database.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';
import { searchableText } from '../utils/conversation-text.js';

/**
 * SQLite implementation of ConversationStore.
 */
export class SQLiteConversationStore implements ConversationStore {
  private readonly database: SQLiteDatabase;
  private readonly logger: Logger;

  constructor(database: SQLiteDatabase, logger?: Logger) {
    this.database = database;
    this.logger = logger ?? createLogger({ level: 'warn', prefix: 'SQLiteConversationStore' });
  }

  appendMessage(message: ChatMessage, threadId: string): void {
    this.database.transaction(() => {
      const result = this.database.db
        .prepare(
          `
      INSERT INTO conversations (thread_id, role, content, tool_calls, tool_call_id, pinned, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
        )
        .run(
          threadId,
          message.role,
          typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
          message.toolCalls ? JSON.stringify(message.toolCalls) : null,
          message.toolCallId ?? null,
          message.pinned ? 1 : 0,
          message.createdAt,
        );

      const body = searchableText(message.role, message.content);
      if (body.trim() === '') return;
      // The history is the source of truth: a message the index could not
      // take is still kept — it just will not turn up in a search.
      try {
        this.database.db
          .prepare('INSERT INTO conversations_fts(rowid, body) VALUES (?, ?)')
          .run(result.lastInsertRowid, body);
      } catch (error) {
        this.logger.warn('Message kept but not indexed for search', { error: String(error) });
      }
    });
  }

  listThread(threadId: string): ChatMessage[] {
    const rows = this.database.db
      .prepare('SELECT * FROM conversations WHERE thread_id = ? ORDER BY created_at ASC')
      .all(threadId) as unknown as ConversationRow[];
    return rows.map((row) => rowToMessage(row, this.logger));
  }

  listPinned(threadId: string): ChatMessage[] {
    const rows = this.database.db
      .prepare(
        'SELECT * FROM conversations WHERE thread_id = ? AND pinned = 1 ORDER BY created_at ASC',
      )
      .all(threadId) as unknown as ConversationRow[];
    return rows.map((row) => rowToMessage(row, this.logger));
  }

  clearThread(threadId: string): void {
    // The delete trigger clears the search index along with the rows.
    this.database.db.prepare('DELETE FROM conversations WHERE thread_id = ?').run(threadId);
  }

  searchMessages(
    query: ConversationSearchQuery,
    threadIds: readonly string[],
  ): ConversationSearchPage {
    if (threadIds.length === 0 || query.roles.length === 0) return { hits: [], hasMore: false };

    const where: string[] = [
      `c.thread_id IN (${threadIds.map(() => '?').join(', ')})`,
      `c.role IN (${query.roles.map(() => '?').join(', ')})`,
    ];
    const params: (string | number)[] = [...threadIds, ...query.roles];
    if (query.after !== undefined) {
      where.push('c.created_at >= ?');
      params.push(query.after);
    }
    if (query.before !== undefined) {
      where.push('c.created_at < ?');
      params.push(query.before);
    }

    const match = toMatchExpression(query.terms, query.match);
    // Terms were given but none is a word: nothing can match. Falling through
    // to the time-ordered listing would answer a question nobody asked.
    if (query.terms.length > 0 && match === undefined) return { hits: [], hasMore: false };
    // snippet() counts tokens, not characters: roughly seven characters each.
    const snippetTokens = Math.max(4, Math.min(64, Math.round(query.snippetChars / 7)));
    const sql = match
      ? `SELECT c.thread_id, c.role, c.created_at,
                snippet(conversations_fts, 0, '«', '»', '…', ${snippetTokens}) AS excerpt
           FROM conversations_fts JOIN conversations c ON c.id = conversations_fts.rowid
          WHERE conversations_fts MATCH ? AND ${where.join(' AND ')}
          ORDER BY bm25(conversations_fts), c.created_at DESC
          LIMIT ? OFFSET ?`
      : `SELECT c.thread_id, c.role, c.created_at, conversations_fts.body AS excerpt
           FROM conversations c JOIN conversations_fts ON conversations_fts.rowid = c.id
          WHERE ${where.join(' AND ')}
          ORDER BY c.created_at DESC
          LIMIT ? OFFSET ?`;

    // One extra row answers "is there more?" without a count query.
    const rows = this.database.db
      .prepare(sql)
      .all(...(match ? [match] : []), ...params, query.limit + 1, query.offset) as unknown as {
      thread_id: string;
      role: string;
      created_at: number;
      excerpt: string;
    }[];

    return {
      hits: rows.slice(0, query.limit).map((row) => ({
        threadId: row.thread_id,
        role: row.role as ConversationSearchRole,
        createdAt: row.created_at,
        snippet: capExcerpt(row.excerpt, query.snippetChars),
      })),
      hasMore: rows.length > query.limit,
    };
  }
}

/**
 * The FTS5 expression for plain words. Each term is quoted — so `"`, `*`,
 * `NEAR(` or `col:` typed by anyone are text, not syntax — and terms of four
 * or more characters also match as prefixes ("deploy" finds "deploys").
 */
function toMatchExpression(terms: readonly string[], match: 'all' | 'any'): string | undefined {
  const quoted = terms
    .map((t) => t.trim())
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
    .map((t) => `"${t.replace(/"/g, '""')}"${[...t].length >= 4 ? '*' : ''}`);
  if (quoted.length === 0) return undefined;
  return quoted.join(match === 'all' ? ' AND ' : ' OR ');
}

function capExcerpt(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

const VALID_ROLES = new Set<string>(['user', 'assistant', 'system', 'tool']);

function rowToMessage(row: ConversationRow, logger: Logger): ChatMessage {
  if (!VALID_ROLES.has(row.role)) {
    throw new Error(`Invalid message role in database: "${row.role}"`);
  }

  let content: string | { type: string; text?: string; image_url?: { url: string } }[];
  try {
    const parsed: unknown = JSON.parse(row.content);
    content = Array.isArray(parsed)
      ? (parsed as { type: string; text?: string; image_url?: { url: string } }[])
      : row.content;
  } catch {
    content = row.content;
  }

  let toolCalls: ChatMessage['toolCalls'];
  if (row.tool_calls) {
    try {
      toolCalls = JSON.parse(row.tool_calls) as ChatMessage['toolCalls'];
    } catch (e) {
      // Issue #25: corrupted tool_calls must be loud, not silently dropped —
      // partial writes, migration bugs, or manual DB edits would otherwise
      // feed the LLM a truncated history. Issue #63: use the injected logger
      // (never console.* directly) so tests / hosts can capture warnings.
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.warn(
        `[SQLiteConversationStore] Invalid tool_calls JSON (rowId=${row.id}, threadId=${row.thread_id}): ${errMsg}`,
      );
      throw new Error(
        `Corrupted tool_calls JSON for rowId=${row.id} (threadId=${row.thread_id}): ${errMsg}`,
        { cause: e },
      );
    }
  }

  return {
    role: row.role as ChatMessage['role'],
    content: content as ChatMessage['content'],
    toolCalls,
    toolCallId: row.tool_call_id ?? undefined,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
  };
}

interface ConversationRow {
  id: number;
  thread_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  pinned: number;
  created_at: number;
}
