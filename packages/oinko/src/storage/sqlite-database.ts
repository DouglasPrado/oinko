import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runInTransaction } from './sqlite-transaction.js';

/**
 * Centralized SQLite wrapper with auto-create tables, migrations, and WAL mode.
 *
 * Usa o SQLite embutido do Node (`node:sqlite`), e nao um driver nativo: a
 * compilacao via node-gyp quebrava a cada ABI nova do Node, e o binding do
 * better-sqlite3 nao tinha prebuild para o Node 26. O modulo e sincrono, que e
 * o que os contratos `ConversationStore` e `VectorStore` exigem.
 */
export class SQLiteDatabase {
  private _db: DatabaseSync | null = null;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  get db(): DatabaseSync {
    if (!this._db) throw new Error('Database not initialized. Call initialize() first.');
    return this._db;
  }

  initialize(): void {
    if (this._db) return;

    // Auto-create parent directory for file-based databases
    if (this.path !== ':memory:') {
      mkdirSync(dirname(this.path), { recursive: true });
    }

    const db = new DatabaseSync(this.path);

    // Enable WAL mode for concurrent reads.
    // Via exec(): o `node:sqlite` nao tem o atalho `.pragma()` do better-sqlite3.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');

    try {
      this.migrateV1(db);
      this.migrateV2(db);
      this._db = db;
    } catch (err) {
      db.close();
      throw err;
    }
  }

  /** Roda `fn` dentro de uma transacao, revertendo tudo se ela lancar. */
  transaction<T>(fn: () => T): T {
    return runInTransaction(this.db, fn);
  }

  close(): void {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  /**
   * Adds the scope column to `vectors`.
   *
   * Rows written before this migration keep a NULL scope, which belongs to no
   * conversation and therefore matches no search. That is deliberate: making
   * old rows visible would mean picking a conversation to leak them into.
   * Re-ingest them under the right scope if they are still wanted.
   */
  private migrateV2(db: DatabaseSync): void {
    const columns = db.prepare('PRAGMA table_info(vectors)').all() as unknown as {
      name: string;
    }[];
    if (columns.some((column) => column.name === 'scope')) return;

    db.exec('ALTER TABLE vectors ADD COLUMN scope TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_vectors_scope ON vectors(scope)');
  }

  private migrateV1(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        scope TEXT NOT NULL,
        category TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.8,
        access_count INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'extracted',
        thread_id TEXT,
        embedding BLOB,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
      CREATE INDEX IF NOT EXISTS idx_memories_thread ON memories(thread_id);
      CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence);
    `);

    // FTS5 virtual table for full-text search
    // Check if already exists (FTS5 tables don't support IF NOT EXISTS in all versions)
    const ftsExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'")
      .get();

    if (!ftsExists) {
      db.exec(`
        CREATE VIRTUAL TABLE memories_fts USING fts5(
          content,
          content=memories,
          content_rowid=rowid
        );
      `);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_call_id TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_thread ON conversations(thread_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_pinned ON conversations(thread_id, pinned);
    `);
  }
}
