import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArtifactStore, hashParams, purgeJournal, readJournal } from '../../src/programming/index.js';
import { botView, makeRun, openStore, twoBotMatrix } from './helpers.js';

const TOKEN = 'ghp_' + 'Z'.repeat(36);

function setup(capture: 'full' | 'hashed' | 'none' = 'full') {
  let clock = 1_000_000;
  const access = twoBotMatrix();
  access.bots.set('alpha', botView('alpha', {}, { capture, retentionDays: 1 }));
  const context = openStore(undefined, () => clock);
  const artifacts = new ArtifactStore(context.store, context.journal, access, join(context.dir, 'artifacts'), {
    signingKey: Buffer.alloc(32, 7),
    now: () => clock,
  });
  const run = context.store.insertRun(makeRun(access, 'alpha', 'two'), 'h').run;
  return { ...context, access, artifacts, run, advance: (ms: number) => (clock += ms) };
}

describe('ArtifactStore', () => {
  it('redacts text before writing and never stores planted secrets on disk', () => {
    const { artifacts, run, dir } = setup();
    const artifact = artifacts.put(run, { type: 'log', content: `push with Authorization: Bearer ${TOKEN}` });
    const files = readdirSync(join(dir, 'artifacts'), { recursive: true }).map(String);
    const content = files
      .filter((file) => file.includes('/'))
      .map((file) => readFileSync(join(dir, 'artifacts', file), 'utf8'))
      .join();
    expect(content).not.toContain(TOKEN);
    expect(content).toContain('[redacted]');
    expect(artifacts.read({ kind: 'bot', botId: 'alpha' }, artifact.id).content.toString()).not.toContain(TOKEN);
  });

  it('keeps metadata but no content with capture none and shows it as unavailable', () => {
    const { artifacts, run } = setup('none');
    const artifact = artifacts.put(run, { type: 'diff', content: 'segredo do negócio' });
    expect(artifact).toMatchObject({ capturePolicy: 'none', size: expect.any(Number) });
    expect(() => artifacts.read({ kind: 'operator', id: 'op' }, artifact.id)).toThrow(/não capturado/);
  });

  it('isolates artifacts between bots and hides restricted screenshots', () => {
    const { artifacts, run, access } = setup();
    const diff = artifacts.put(run, { type: 'diff', content: 'diff --git' });
    const shot = artifacts.put(run, { type: 'screenshot', content: new Uint8Array([1, 2]), mediaType: 'image/png', restricted: true });
    expect(() => artifacts.read({ kind: 'bot', botId: 'beta' }, diff.id)).toThrow(/não encontrado/);
    expect(() => artifacts.read({ kind: 'bot', botId: 'beta' }, 'art-guess')).toThrow(/não encontrado/);
    expect(artifacts.read({ kind: 'operator', id: 'op' }, shot.id).content).toEqual(Buffer.from([1, 2]));
    // Revoking project access cuts reads immediately.
    access.projects.set('two', { ...access.project('two')!, allowedBotIds: ['beta'] });
    expect(() => artifacts.read({ kind: 'bot', botId: 'alpha' }, diff.id)).toThrow(/não encontrado/);
  });

  it('refuses tampered, traversal and expired links', () => {
    const { artifacts, run, advance, store } = setup();
    const artifact = artifacts.put(run, { type: 'log', content: 'ok' });
    const link = artifacts.createLink({ kind: 'bot', botId: 'alpha' }, artifact.id, 60_000);
    expect(artifacts.readLink(link).content.toString()).toBe('ok');
    const [payload, signature] = link.split('.');
    const forged = Buffer.from(JSON.stringify({ id: artifact.id, actor: { kind: 'operator', id: 'x' }, exp: 9e15 })).toString('base64url');
    expect(() => artifacts.readLink(`${forged}.${signature}`)).toThrow(/não encontrado/);
    expect(() => artifacts.readLink(`${payload}.`)).toThrow(/não encontrado/);
    store.database.db.prepare("UPDATE artifacts SET location = '../../etc/passwd' WHERE id = ?").run(artifact.id);
    expect(() => artifacts.readLink(link)).toThrow();
    advance(120_000);
    expect(() => artifacts.readLink(link)).toThrow(/expirou/);
  });

  it('keeps evidence of live runs and uncertain operations past retention, then expires it', () => {
    const { artifacts, run, advance, store, database } = setup();
    const artifact = artifacts.put(run, { type: 'log', content: 'evidência' });
    advance(2 * 86_400_000);
    expect(artifacts.expire()).toEqual([]); // run still queued
    const running = store.transitionRun(run.id, store.getRun(run.id)!.revision, 'running').run;
    store.insertReceipt({ operationId: 'op-u', runId: run.id, kind: 'k', idempotencyKey: 'k', paramsHash: hashParams(1), actor: { kind: 'bot', botId: 'alpha' }, intent: {}, preconditions: {}, state: 'uncertain', attempt: 1, createdAt: 1 });
    const cancelled = store.transitionRun(run.id, running.revision, 'cancelled').run;
    expect(cancelled.state).toBe('cancelled');
    expect(artifacts.expire()).toEqual([]); // uncertain receipt pending reconciliation
    store.updateReceipt('op-u', { state: 'succeeded' });
    const expired = artifacts.expire();
    expect(expired.map((item) => item.id)).toEqual([artifact.id]);
    expect(() => artifacts.read({ kind: 'operator', id: 'op' }, artifact.id)).toThrow(/expirou/);
    expect(readJournal(database, { type: 'artifact_expired' })).toHaveLength(1);
    // The expired artifact still has metadata to explain the run.
    expect(artifacts.get(artifact.id)).toMatchObject({ size: 10, expiredAt: expect.any(Number) });
  });

  it('collects orphan files but keeps shared content referenced by another artifact', () => {
    const { artifacts, run, store } = setup();
    const a = artifacts.put(run, { type: 'log', content: 'same' });
    artifacts.put(run, { type: 'log', content: 'same' });
    store.database.db.prepare('UPDATE artifacts SET expired_at = 1 WHERE id = ?').run(a.id);
    expect(artifacts.collectOrphans()).toEqual([]);
    store.database.db.prepare('UPDATE artifacts SET expired_at = 1').run();
    expect(artifacts.collectOrphans()).toHaveLength(1);
  });

  it('purges delivered journal rows only for finished runs', () => {
    const { store, journal, run, database } = setup();
    journal.record('run_created', { runId: run.id, botId: 'alpha' }, { mode: 'change' });
    database.db.exec('UPDATE telemetry_outbox SET delivered_at = 1, occurred_at = 1');
    expect(purgeJournal(store, 1, 10 * 86_400_000)).toBe(0);
    store.transitionRun(run.id, store.getRun(run.id)!.revision, 'cancelled');
    expect(purgeJournal(store, 1, 10 * 86_400_000)).toBe(1);
  });
});
