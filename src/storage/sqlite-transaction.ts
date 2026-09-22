import type { DatabaseSync } from 'node:sqlite';

/**
 * Roda `fn` dentro de uma transacao, revertendo tudo se ela lancar.
 *
 * Substitui o `db.transaction()` do better-sqlite3, que o `node:sqlite` nao
 * tem. O ROLLBACK vai dentro de try/catch proprio porque, se a falha original
 * ja tiver abortado a transacao, o proprio ROLLBACK lanca — e engolir o erro
 * de verdade para relatar o do rollback trocaria o diagnostico pelo sintoma.
 */
export function runInTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // transacao ja abortada pelo SQLite; o erro que importa e o `err`
    }
    throw err;
  }
}
