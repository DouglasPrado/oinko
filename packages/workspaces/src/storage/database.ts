import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { WorkspaceError, type Saved } from '../contracts/index.js';

export class LocalDatabase {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    try {
      chmodSync(path, 0o600);
      this.db.exec(
        'PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS documents (kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));',
      );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  get<T>(kind: string, id: string): Saved<T> | undefined {
    const row = this.db
      .prepare('SELECT data,revision FROM documents WHERE kind=? AND id=?')
      .get(kind, id);
    return row
      ? ({ ...JSON.parse(String(row.data)), revision: Number(row.revision) } as Saved<T>)
      : undefined;
  }
  list<T>(kind: string): Saved<T>[] {
    return this.db
      .prepare('SELECT data,revision FROM documents WHERE kind=? ORDER BY id')
      .all(kind)
      .map(
        (row) => ({ ...JSON.parse(String(row.data)), revision: Number(row.revision) }) as Saved<T>,
      );
  }
  save<T extends { id: string }>(kind: string, value: T, revision: number): Saved<T> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get<T>(kind, value.id);
      if ((current?.revision ?? 0) !== revision)
        throw new WorkspaceError('O cadastro foi alterado. Atualize antes de salvar.');
      const next = revision + 1;
      const data = { ...value } as T & { revision?: number };
      delete data.revision;
      this.db
        .prepare(
          'INSERT INTO documents(kind,id,revision,data) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,data=excluded.data',
        )
        .run(kind, value.id, next, JSON.stringify(data));
      this.db.exec('COMMIT');
      return { ...value, revision: next };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  /** Deletes a document; true when it existed. */
  remove(kind: string, id: string): boolean {
    return Number(this.db.prepare('DELETE FROM documents WHERE kind=? AND id=?').run(kind, id).changes) > 0;
  }
  close() {
    this.db.close();
  }
}
