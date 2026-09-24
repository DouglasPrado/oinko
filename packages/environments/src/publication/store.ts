import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PublicationError, type ErrorBody } from './errors.js';

const KEY_FILE = 'publication.key';
const SCHEMA_VERSION = 1;
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface AppRecord {
  appId: string;
  apiUrl: string;
  webUrl: string;
  gitUrl: string;
  /** SHA256:<base64> of the public key (SPKI DER), as GitHub shows it. */
  fingerprint: string;
  createdAt: string;
  rotatedAt: string;
  revision: number;
}

type ReceiptState = 'intended' | 'running' | 'succeeded' | 'failed' | 'uncertain';
export interface Receipt {
  key: string;
  action: string;
  operationId: string;
  botId: string;
  projectId: string;
  taskId: string;
  repositoryId: string;
  paramsHash: string;
  state: ReceiptState;
  phase: string;
  attempt: number;
  createdAt: number;
  updatedAt: number;
  data: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: ErrorBody;
  runId?: string;
}

export interface PublicationRecord {
  id: string;
  projectId: string;
  taskId: string;
  repositoryId: string;
  owner: string;
  name: string;
  branch: string;
  baseBranch: string;
  originatingBotId: string;
  contributingBotIds: string[];
  originatingRunId?: string;
  contributingRunIds: string[];
  remoteSha?: string;
  pullRequest?: { number: number; url: string; state: string; draft: boolean; merged: boolean };
  reconciliationState: 'synced' | 'uncertain' | 'diverged' | 'unpublished';
  updatedAt: string;
}

export interface PublicationEvent {
  schemaVersion: 1;
  eventId: string;
  type: string;
  producer: 'runner';
  seq: number;
  occurredAt: number;
  status: 'started' | 'succeeded' | 'failed' | 'denied' | 'uncertain' | 'info';
  capture: 'none';
  botId?: string;
  projectId?: string;
  taskId?: string;
  runId?: string;
  stepId?: string;
  operationId?: string;
  attemptId?: string;
  durationMs?: number;
  error?: { code: string; message: string; retryable: boolean };
  payload: Record<string, string | number | boolean | null>;
}

function readKey(path: string): Buffer {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size !== 32)
      throw new PublicationError('master_key_missing', 'Chave de publicação inválida.');
    const key = readFileSync(descriptor);
    if (key.length !== 32)
      throw new PublicationError('master_key_missing', 'Chave de publicação inválida.');
    fchmodSync(descriptor, 0o600);
    return key;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Runner-owned publication state in `.harness/publication.db`. The App private
 * key is AES-256-GCM encrypted with a 32-byte master key kept in
 * `.harness/publication.key` (0600), never in the database. `.harness` is never
 * mounted into a container; only `.harness/workspaces/<project>` is.
 */
export class PublicationStore {
  private readonly db: DatabaseSync;
  readonly directory: string;
  constructor(readonly root: string) {
    this.directory = join(root, '.harness');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, 'publication.db');
    this.db = new DatabaseSync(path);
    try {
      chmodSync(path, 0o600);
      this.db.exec(`
        PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS app (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL, encrypted TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS receipts (key TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, repository_id TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS receipts_target ON receipts(project_id, task_id, repository_id);
        CREATE TABLE IF NOT EXISTS publications (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, project_id TEXT, occurred_at INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS events_project ON events(project_id, seq);
      `);
      this.db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
      // Receipts are kept; only old telemetry expires.
      this.db
        .prepare('DELETE FROM events WHERE occurred_at < ?')
        .run(Date.now() - EVENT_RETENTION_MS);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private masterKey(create: boolean): Buffer {
    const path = join(this.directory, KEY_FILE);
    try {
      return readKey(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!create)
      throw new PublicationError(
        'master_key_missing',
        'Chave mestra de publicação ausente (.harness/publication.key). Restaure o backup ou salve a GitHub App novamente.',
      );
    const temporary = mkdtempSync(join(this.directory, '.publication-key-'));
    try {
      const candidate = join(temporary, 'key');
      writeFileSync(candidate, randomBytes(32), { mode: 0o600, flag: 'wx' });
      // Publish complete bytes atomically; a concurrent initializer keeps its key.
      try {
        linkSync(candidate, path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
    return readKey(path);
  }
  private encrypt(plain: string, aad: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey(true), iv);
    cipher.setAAD(Buffer.from(aad));
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  private decrypt(encrypted: string, aad: string) {
    const data = Buffer.from(encrypted, 'base64');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.masterKey(false), data.subarray(0, 12));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    } catch (error) {
      if (error instanceof PublicationError) throw error;
      throw new PublicationError(
        'master_key_missing',
        'A chave mestra não corresponde à configuração salva. Restaure o backup da chave ou salve a GitHub App novamente.',
      );
    }
  }

  app(): AppRecord | undefined {
    const row = this.db.prepare('SELECT data, revision FROM app WHERE id = ?').get('github');
    return row
      ? { ...(JSON.parse(String(row.data)) as AppRecord), revision: Number(row.revision) }
      : undefined;
  }
  /** Saves (or rotates) the App configuration; the PEM is only stored encrypted. */
  saveApp(value: Omit<AppRecord, 'revision' | 'createdAt' | 'rotatedAt'>, privateKeyPem: string) {
    const previous = this.app();
    const now = new Date().toISOString();
    const record: Omit<AppRecord, 'revision'> = {
      ...value,
      createdAt: previous?.createdAt ?? now,
      rotatedAt: now,
    };
    const revision = (previous?.revision ?? 0) + 1;
    const encrypted = this.encrypt(privateKeyPem, `oinko-github-app:${value.appId}`);
    this.db
      .prepare(
        'INSERT INTO app(id, revision, data, encrypted) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, data=excluded.data, encrypted=excluded.encrypted',
      )
      .run('github', revision, JSON.stringify(record), encrypted);
    return { ...record, revision };
  }
  privateKeyPem(): string {
    const row = this.db.prepare('SELECT data, encrypted FROM app WHERE id = ?').get('github');
    if (!row)
      throw new PublicationError(
        'github_app_not_configured',
        'Configure a GitHub App da instância.',
      );
    const record = JSON.parse(String(row.data)) as AppRecord;
    return this.decrypt(String(row.encrypted), `oinko-github-app:${record.appId}`);
  }
  keyAvailable() {
    try {
      this.masterKey(false);
      return true;
    } catch {
      return false;
    }
  }

  receipt(key: string): Receipt | undefined {
    const row = this.db.prepare('SELECT data FROM receipts WHERE key = ?').get(key);
    return row ? (JSON.parse(String(row.data)) as Receipt) : undefined;
  }
  saveReceipt(receipt: Receipt) {
    receipt.updatedAt = Date.now();
    this.db
      .prepare(
        'INSERT INTO receipts(key, project_id, task_id, repository_id, state, updated_at, data) VALUES(?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at, data=excluded.data',
      )
      .run(
        receipt.key,
        receipt.projectId,
        receipt.taskId,
        receipt.repositoryId,
        receipt.state,
        receipt.updatedAt,
        JSON.stringify(receipt),
      );
    return receipt;
  }
  receipts(projectId: string, taskId: string, repositoryId: string): Receipt[] {
    return this.db
      .prepare(
        'SELECT data FROM receipts WHERE project_id = ? AND task_id = ? AND repository_id = ? ORDER BY updated_at',
      )
      .all(projectId, taskId, repositoryId)
      .map((row) => JSON.parse(String(row.data)) as Receipt);
  }
  /** Runner restart: an effect without a final receipt has an unknown outcome. */
  markInterrupted(): Receipt[] {
    const open = this.db
      .prepare("SELECT data FROM receipts WHERE state IN ('intended','running')")
      .all()
      .map((row) => JSON.parse(String(row.data)) as Receipt);
    for (const receipt of open) this.saveReceipt({ ...receipt, state: 'uncertain' });
    return open;
  }

  publication(id: string): PublicationRecord | undefined {
    const row = this.db.prepare('SELECT data FROM publications WHERE id = ?').get(id);
    return row ? (JSON.parse(String(row.data)) as PublicationRecord) : undefined;
  }
  publications(projectId: string, taskId: string): PublicationRecord[] {
    return this.db
      .prepare('SELECT data FROM publications WHERE project_id = ? AND task_id = ? ORDER BY id')
      .all(projectId, taskId)
      .map((row) => JSON.parse(String(row.data)) as PublicationRecord);
  }
  savePublication(record: PublicationRecord) {
    record.updatedAt = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO publications(id, project_id, task_id, data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(record.id, record.projectId, record.taskId, JSON.stringify(record));
    return record;
  }

  observation<T>(id: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM observations WHERE id = ?').get(id);
    return row ? (JSON.parse(String(row.data)) as T) : undefined;
  }
  saveObservation(id: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO observations(id, data, updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at',
      )
      .run(id, JSON.stringify(value), Date.now());
  }

  record(
    event: Omit<PublicationEvent, 'schemaVersion' | 'eventId' | 'producer' | 'seq' | 'capture'>,
  ) {
    const full = {
      schemaVersion: 1 as const,
      eventId: randomUUID(),
      producer: 'runner' as const,
      capture: 'none' as const,
      ...event,
    };
    const result = this.db
      .prepare(
        'INSERT INTO events(event_id, type, project_id, occurred_at, data) VALUES(?,?,?,?,?)',
      )
      .run(full.eventId, full.type, full.projectId ?? null, full.occurredAt, JSON.stringify(full));
    return { ...full, seq: Number(result.lastInsertRowid) } satisfies PublicationEvent;
  }
  events(options: { after: number; limit: number; projectIds?: string[] }): PublicationEvent[] {
    const rows = options.projectIds
      ? options.projectIds.length
        ? this.db
            .prepare(
              `SELECT seq, data FROM events WHERE seq > ? AND project_id IN (${options.projectIds.map(() => '?').join(',')}) ORDER BY seq LIMIT ?`,
            )
            .all(options.after, ...options.projectIds, options.limit)
        : []
      : this.db
          .prepare('SELECT seq, data FROM events WHERE seq > ? ORDER BY seq LIMIT ?')
          .all(options.after, options.limit);
    return rows.map((row) => ({
      ...(JSON.parse(String(row.data)) as PublicationEvent),
      seq: Number(row.seq),
    }));
  }
  close() {
    this.db.close();
  }
}
