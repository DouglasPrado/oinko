import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
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
import { z } from 'zod';
import { LocalDatabase, WorkspaceError } from '@oinko/workspaces';
import { MIN_SECRET_LENGTH } from './redact.js';
import type { SessionKind } from './policy.js';

export type SessionState = 'active' | 'closed' | 'failed' | 'revoked' | 'expired';
export interface SessionRecord {
  id: string;
  botId: string;
  runId: string;
  projectId: string;
  kind: SessionKind;
  state: SessionState;
  createdAt: string;
  viewport: { width: number; height: number };
  mobile: boolean;
  closedAt?: string;
  /** Why it ended, e.g. `closed`, `idle_timeout`, `access_revoked`. */
  reason?: string;
  /** Failure code for `failed` sessions, e.g. `browser_crashed`, `runner_restarted`. */
  code?: string;
}
interface StoredCredential {
  id: string;
  projectId: string;
  name: string;
  updatedAt: string;
  encrypted?: string;
  /** Previous values, kept only so later output stays redacted after rotation. */
  history?: string;
  deleted?: boolean;
}
const Values = z.object({ username: z.string(), password: z.string() });
const MAX_HISTORY = 20;

function readKey(path: string): Buffer {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size !== 32)
      throw new WorkspaceError('Chave do navegador inválida.');
    const key = readFileSync(descriptor);
    if (key.length !== 32) throw new WorkspaceError('Chave do navegador inválida.');
    fchmodSync(descriptor, 0o600);
    return key;
  } finally {
    closeSync(descriptor);
  }
}

/** Same publication rules as the environments key: atomic, never silently replaced. */
function encryptionKey(directory: string): Buffer {
  const path = join(directory, 'browser.key');
  try {
    return readKey(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (existsSync(join(directory, 'browser.db')))
    throw new WorkspaceError('Chave do navegador ausente. Restaure o backup da chave.');
  const temporary = mkdtempSync(join(directory, '.browser-key-'));
  try {
    const candidate = join(temporary, 'key');
    writeFileSync(candidate, randomBytes(32), { mode: 0o600, flag: 'wx' });
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

/**
 * Browser persistence: project test credentials (AES-256-GCM, key file outside
 * the database, ciphertext bound to project/name) and session metadata kept
 * as evidence after a session ends.
 */
export class BrowserStore {
  private readonly db: LocalDatabase;
  private readonly key: Buffer;
  constructor(readonly root: string) {
    const directory = join(root, '.harness');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.key = encryptionKey(directory);
    this.db = new LocalDatabase(join(directory, 'browser.db'));
  }
  private encode(value: unknown, aad: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  private decode(encrypted: string, aad: string): unknown {
    try {
      const data = Buffer.from(encrypted, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(data.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
      );
    } catch {
      throw new WorkspaceError('Credencial de teste ilegível. Salve-a novamente.');
    }
  }
  private aad(projectId: string, name: string, part: string) {
    return `oinko-browser-credential:${projectId}/${name}:${part}`;
  }
  private stored(projectId: string, name: string) {
    return this.db.get<StoredCredential>('credential', `${projectId}/${name}`);
  }
  private history(record: StoredCredential | undefined): string[] {
    if (!record?.history) return [];
    return z
      .array(z.string())
      .parse(this.decode(record.history, this.aad(record.projectId, record.name, 'history')));
  }
  saveCredential(projectId: string, name: string, username: string, password: string) {
    if (username.length < MIN_SECRET_LENGTH || password.length < MIN_SECRET_LENGTH)
      throw new WorkspaceError(
        `Usuário e senha de teste precisam de pelo menos ${MIN_SECRET_LENGTH} caracteres.`,
      );
    const previous = this.stored(projectId, name);
    const history = this.history(previous);
    const current = previous?.encrypted && this.credential(projectId, name);
    if (current) history.push(current.username, current.password);
    const record: StoredCredential = {
      id: `${projectId}/${name}`,
      projectId,
      name,
      updatedAt: new Date().toISOString(),
      encrypted: this.encode({ username, password }, this.aad(projectId, name, 'value')),
      ...(history.length && {
        history: this.encode(
          [...new Set(history)].slice(-MAX_HISTORY),
          this.aad(projectId, name, 'history'),
        ),
      }),
    };
    this.db.save('credential', record, previous?.revision ?? 0);
    return { projectId, name, updatedAt: record.updatedAt };
  }
  /** Tombstone: the value is gone, its history keeps later output redacted. */
  deleteCredential(projectId: string, name: string) {
    const previous = this.stored(projectId, name);
    if (!previous || previous.deleted) return false;
    const history = this.history(previous);
    const current = this.credential(projectId, name);
    if (current) history.push(current.username, current.password);
    this.db.save(
      'credential',
      {
        id: previous.id,
        projectId,
        name,
        updatedAt: new Date().toISOString(),
        deleted: true,
        history: this.encode(
          [...new Set(history)].slice(-MAX_HISTORY),
          this.aad(projectId, name, 'history'),
        ),
      },
      previous.revision,
    );
    return true;
  }
  credentialNames(projectId: string) {
    return this.db
      .list<StoredCredential>('credential')
      .filter((record) => record.projectId === projectId && !record.deleted)
      .map((record) => ({ name: record.name, updatedAt: record.updatedAt }));
  }
  /** Decrypted value for injection into a test session. Never returned by a command. */
  credential(projectId: string, name: string) {
    const record = this.stored(projectId, name);
    if (!record?.encrypted || record.deleted) return undefined;
    return Values.parse(this.decode(record.encrypted, this.aad(projectId, name, 'value')));
  }
  /** Every known value (current and previous) of the project, for redaction. */
  secrets(projectId: string): string[] {
    const values = new Set<string>();
    for (const record of this.db.list<StoredCredential>('credential')) {
      if (record.projectId !== projectId) continue;
      for (const value of this.history(record)) values.add(value);
      const current = !record.deleted && this.credential(projectId, record.name);
      if (current) {
        values.add(current.username);
        values.add(current.password);
      }
    }
    return [...values];
  }
  saveSession(record: SessionRecord) {
    return this.db.save(
      'session',
      record,
      this.db.get<SessionRecord>('session', record.id)?.revision ?? 0,
    );
  }
  session(id: string) {
    return this.db.get<SessionRecord>('session', id);
  }
  sessions() {
    return this.db
      .list<SessionRecord>('session')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /** Marks sessions left active by a previous runner process as failed. */
  failActiveSessions(code: string) {
    const failed: string[] = [];
    for (const session of this.db.list<SessionRecord>('session')) {
      if (session.state !== 'active') continue;
      this.saveSession({ ...session, state: 'failed', code, closedAt: new Date().toISOString() });
      failed.push(session.id);
    }
    return failed;
  }
  close() {
    this.db.close();
  }
}
