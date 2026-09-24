import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowserStore } from '../src/browser/store.js';

describe('BrowserStore', () => {
  let root: string;
  let store: BrowserStore;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'oinko-browser-store-'));
    store = new BrowserStore(root);
  });
  afterEach(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('encrypts credentials at rest with a private key file and never lists values', () => {
    const saved = store.saveCredential(
      'alpha',
      'admin',
      'qa-user@example.com',
      'Planted-Secret-991',
    );
    expect(saved).toEqual({ projectId: 'alpha', name: 'admin', updatedAt: expect.any(String) });
    expect(JSON.stringify(saved)).not.toContain('Planted-Secret-991');
    expect(store.credentialNames('alpha')).toEqual([{ name: 'admin', updatedAt: saved.updatedAt }]);
    expect(JSON.stringify(store.credentialNames('alpha'))).not.toMatch(/qa-user|Planted/);
    expect(store.credential('alpha', 'admin')).toEqual({
      username: 'qa-user@example.com',
      password: 'Planted-Secret-991',
    });
    store.close();
    const bytes = readFileSync(join(root, '.harness/browser.db'));
    for (const value of ['Planted-Secret-991', 'qa-user@example.com'])
      expect(bytes.includes(Buffer.from(value))).toBe(false);
    expect(statSync(join(root, '.harness/browser.key')).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, '.harness/browser.db')).mode & 0o777).toBe(0o600);
    store = new BrowserStore(root);
    expect(store.credential('alpha', 'admin')?.password).toBe('Planted-Secret-991');
  });

  it('scopes credentials to their project, supports rotation and deletion, and feeds redaction', () => {
    store.saveCredential('alpha', 'admin', 'alpha-user', 'alpha-pass-1');
    store.saveCredential('beta', 'admin', 'beta-user', 'beta-pass-1');
    expect(store.credential('alpha', 'missing')).toBeUndefined();
    expect(store.credential('gamma', 'admin')).toBeUndefined();
    expect(store.credential('beta', 'admin')?.username).toBe('beta-user');
    store.saveCredential('alpha', 'admin', 'alpha-user', 'alpha-pass-2');
    expect(store.credential('alpha', 'admin')?.password).toBe('alpha-pass-2');
    expect(store.secrets('alpha').sort()).toEqual(
      ['alpha-pass-1', 'alpha-pass-2', 'alpha-user'].sort(),
    );
    expect(store.deleteCredential('alpha', 'admin')).toBe(true);
    expect(store.deleteCredential('alpha', 'admin')).toBe(false);
    expect(store.credential('alpha', 'admin')).toBeUndefined();
    expect(store.credentialNames('alpha')).toEqual([]);
    // Rotated and deleted values stay redacted in later output.
    expect(store.secrets('alpha')).toEqual(
      expect.arrayContaining(['alpha-pass-1', 'alpha-pass-2']),
    );
  });

  it('binds each ciphertext to its project and name: a swapped record does not decrypt', () => {
    store.saveCredential('alpha', 'admin', 'alpha-user', 'alpha-pass-1');
    store.saveCredential('beta', 'admin', 'beta-user', 'beta-pass-1');
    store.close();
    const db = new DatabaseSync(join(root, '.harness/browser.db'));
    const rows = db.prepare("SELECT id, data FROM documents WHERE kind='credential'").all() as {
      id: string;
      data: string;
    }[];
    const alpha = JSON.parse(rows.find((row) => row.id === 'alpha/admin')!.data);
    const beta = JSON.parse(rows.find((row) => row.id === 'beta/admin')!.data);
    db.prepare("UPDATE documents SET data=? WHERE kind='credential' AND id='beta/admin'").run(
      JSON.stringify({ ...beta, encrypted: alpha.encrypted }),
    );
    db.close();
    store = new BrowserStore(root);
    expect(() => store.credential('beta', 'admin')).toThrow(/credencial/i);
  });

  it('refuses to create a new key when the database already exists', () => {
    store.saveCredential('alpha', 'admin', 'alpha-user', 'alpha-pass-1');
    store.close();
    rmSync(join(root, '.harness/browser.key'));
    expect(() => new BrowserStore(root)).toThrow(/Chave do navegador ausente/);
    store = { close() {} } as BrowserStore;
  });

  it('refuses credential values too short to redact safely', () => {
    expect(() => store.saveCredential('alpha', 'admin', 'abc', 'long-enough')).toThrow(/4/);
    expect(() => store.saveCredential('alpha', 'admin', 'long-enough', 'abc')).toThrow(/4/);
  });

  it('persists session metadata and fails active sessions on recovery', () => {
    const base = {
      botId: 'bot-a',
      runId: 'run-1',
      projectId: 'alpha',
      kind: 'test' as const,
      createdAt: '2026-09-24T00:00:00.000Z',
      viewport: { width: 1280, height: 720 },
      mobile: false,
    };
    store.saveSession({ ...base, id: 'bs-000000000000000000000001', state: 'active' });
    store.saveSession({
      ...base,
      id: 'bs-000000000000000000000002',
      state: 'closed',
      reason: 'closed',
    });
    expect(store.failActiveSessions('runner_restarted')).toEqual(['bs-000000000000000000000001']);
    expect(store.session('bs-000000000000000000000001')).toMatchObject({
      state: 'failed',
      code: 'runner_restarted',
      closedAt: expect.any(String),
    });
    expect(store.session('bs-000000000000000000000002')?.state).toBe('closed');
    expect(store.sessions().map((session) => session.id)).toHaveLength(2);
  });
});
