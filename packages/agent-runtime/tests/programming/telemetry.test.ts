import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ProgrammingDatabase,
  SqliteTelemetryRepository,
  TELEMETRY_CATALOG,
  TELEMETRY_EVENT_TYPES,
  TelemetryDeliverer,
  TelemetryJournal,
  applyCapture,
  buildEnvelope,
  parseEnvelope,
  readJournal,
  redactValue,
  type TelemetryEnvelope,
  type TelemetryRepository,
} from '../../src/programming/index.js';

const roots: string[] = [];
function root() {
  const dir = mkdtempSync(join(tmpdir(), 'oinko-telemetry-'));
  roots.push(dir);
  return dir;
}
afterEach(() => roots.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function openDb(dir = root()) {
  const database = new ProgrammingDatabase(join(dir, 'programming.db'));
  database.open();
  return database;
}

const SECRET_TOKEN = 'ghs_' + 'A'.repeat(36);
const PLANTED = {
  headers: { Authorization: `Bearer ${SECRET_TOKEN}`, cookie: 'sid=abc123456789' },
  env: { GITHUB_TOKEN: 'plain-value-123456', NODE_ENV: 'test', DB_PASSWORD: 'hunter2hunter2' },
  nested: [{ url: 'https://x-access-token:supersecret99@github.com/acme/app.git' }],
  log: `export API_KEY=sk-${'b'.repeat(24)} && curl https://api.example.com/?token=abcdef123456`,
  key: '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
};

describe('catalog and envelope', () => {
  it('matches the catalog documented in TELEMETRY.md exactly', () => {
    const doc = readFileSync(
      join(import.meta.dirname, '../../../../docs/milestones/programming-agents/TELEMETRY.md'),
      'utf8',
    );
    const section = doc.slice(doc.indexOf('## Catálogo'), doc.indexOf('## Acesso e retenção'));
    const documented = new Set([...section.matchAll(/`([a-z][a-z0-9_]+)`/g)].map((m) => m[1]!));
    expect([...documented].sort()).toEqual([...TELEMETRY_EVENT_TYPES].sort());
  });

  it('builds a valid envelope for every catalog type', () => {
    for (const type of TELEMETRY_EVENT_TYPES) {
      const entry = TELEMETRY_CATALOG[type];
      const envelope = buildEnvelope(
        { type, runId: 'run-1', botId: 'alpha', payload: 'example' in entry ? entry.example : {} },
        'test',
        1,
        'full',
      );
      expect(parseEnvelope(JSON.parse(JSON.stringify(envelope))).type).toBe(type);
    }
    expect(() => buildEnvelope({ type: 'not_a_type' as never }, 'test', 1, 'full')).toThrow(
      /fora do catálogo/,
    );
    expect(() => buildEnvelope({ type: 'run_state_changed', payload: { from: 1 } }, 'test', 1, 'full')).toThrow(
      /Payload inválido/,
    );
  });

  it('tolerates envelopes from other versions and ignores unknown fields', () => {
    const parsed = parseEnvelope({
      schemaVersion: 2,
      eventId: 'e1',
      type: 'future_event',
      producer: 'newer',
      seq: 3,
      occurredAt: 1,
      status: 'info',
      capture: 'none',
      brandNewField: { nested: true },
    });
    expect(parsed.type).toBe('future_event');
  });

  it('keeps one logical operation across retries with distinct attempt ids', () => {
    const first = buildEnvelope(
      { type: 'operation_intended', operationId: 'op-1', attemptId: 'a1', attempt: 1, payload: { kind: 'x' } },
      'p',
      1,
      'full',
    );
    const retry = buildEnvelope(
      { type: 'operation_intended', operationId: 'op-1', attemptId: 'a2', attempt: 2, payload: { kind: 'x' } },
      'p',
      2,
      'full',
    );
    expect(first.operationId).toBe(retry.operationId);
    expect(first.attemptId).not.toBe(retry.attemptId);
    expect(first.eventId).not.toBe(retry.eventId);
  });
});

describe('redaction and capture', () => {
  it('removes planted secrets at every depth before persisting', () => {
    const text = JSON.stringify(redactValue(PLANTED, ['plain-value-123456']));
    for (const secret of [
      SECRET_TOKEN,
      'abc123456789',
      'plain-value-123456',
      'hunter2hunter2',
      'supersecret99',
      'b'.repeat(24),
      'abcdef123456',
      'MIIEow',
    ])
      expect(text).not.toContain(secret);
    expect(text).toContain('NODE_ENV');
    expect(text).toContain('test');
  });

  it('applies full, hashed and none while keeping safe categorical fields', () => {
    const payload = { kind: 'test', command: 'pnpm test --filter web', exitCode: 1, passed: false };
    expect(applyCapture(payload, 'full', ['kind'])).toEqual(payload);
    const hashed = applyCapture(payload, 'hashed', ['kind'])!;
    expect(hashed.kind).toBe('test');
    expect(hashed.command).toMatchObject({ hash: expect.stringMatching(/^sha256:/), length: 22 });
    expect(applyCapture(payload, 'none', ['kind'])).toEqual({ kind: 'test', exitCode: 1, passed: false });
  });
});

describe('journal and delivery', () => {
  function journal(database: ProgrammingDatabase, capture: 'full' | 'hashed' | 'none' = 'full') {
    return new TelemetryJournal(database, { producer: 'runtime:alpha', capture: () => capture });
  }

  it('persists events with a monotonic per-producer sequence and no secret', () => {
    const database = openDb();
    const events = journal(database);
    events.record('run_created', { runId: 'run-1', botId: 'alpha' }, { mode: 'change', note: PLANTED.log });
    events.record('run_state_changed', { runId: 'run-1', botId: 'alpha' }, { from: 'queued', to: 'running' });
    const stored = readJournal(database, { runId: 'run-1' });
    expect(stored.map((event) => event.envelope.seq)).toEqual([1, 2]);
    const raw = JSON.stringify(database.db.prepare('SELECT * FROM telemetry_outbox').all());
    expect(raw).not.toContain('b'.repeat(24));
    database.close();
  });

  it('keeps a minimal envelope with capture none', () => {
    const database = openDb();
    journal(database, 'none').record(
      'check_finished',
      { runId: 'run-1', botId: 'alpha' },
      { kind: 'test', result: 'failed', output: 'secret business data', exitCode: 2 },
      'failed',
    );
    const [event] = readJournal(database);
    expect(event!.envelope).toMatchObject({ capture: 'none', status: 'failed', runId: 'run-1' });
    expect(event!.envelope.payload).toEqual({ kind: 'test', result: 'failed', exitCode: 2 });
    database.close();
  });

  it('spans record parent, duration and outcome', () => {
    const database = openDb();
    let now = 1_000;
    const events = new TelemetryJournal(database, { producer: 'p', now: () => now });
    const parent = events.span('cycle', { runId: 'run-1' });
    const child = events.span('check', { runId: 'run-1', parentSpanId: parent.spanId });
    now += 250;
    child.finish('succeeded');
    parent.finish('failed', {}, { code: 'x', message: 'falhou', retryable: false });
    const finished = readJournal(database, { type: 'telemetry_span_finished' }).map((e) => e.envelope);
    expect(finished[0]).toMatchObject({ parentSpanId: parent.spanId, durationMs: 250, status: 'succeeded' });
    expect(finished[1]).toMatchObject({ spanId: parent.spanId, status: 'failed', error: { code: 'x' } });
    database.close();
  });

  it('delivers to the bot telemetry database idempotently, even when redelivered or reordered', async () => {
    const dir = root();
    const database = openDb(dir);
    const events = journal(database);
    for (let i = 0; i < 5; i++) events.record('cycle_started', { runId: 'run-1', botId: 'alpha' }, { cycle: i });
    const repository = new SqliteTelemetryRepository('alpha', join(dir, 'telemetry.db'));
    const deliverer = new TelemetryDeliverer(database, events, () => repository);
    expect((await deliverer.flush()).delivered).toBe(5);
    // Force a redelivery of everything, in reverse order.
    const all = readJournal(database).map((event) => event.envelope).reverse();
    repository.write(all);
    const telemetry = new DatabaseSync(join(dir, 'telemetry.db'));
    const rows = telemetry.prepare('SELECT seq FROM telemetry_events ORDER BY seq').all() as { seq: number }[];
    telemetry.close();
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5]);
    database.close();
  });

  it('reports degradation once, keeps events pending and recovers without loss', async () => {
    const database = openDb();
    const events = journal(database);
    events.record('run_created', { runId: 'run-1', botId: 'alpha' }, { mode: 'change' });
    let down = true;
    const received: TelemetryEnvelope[] = [];
    const repository: TelemetryRepository = {
      name: 'alpha',
      write(envelopes) {
        if (down) throw new Error('disk unavailable');
        received.push(...envelopes);
      },
    };
    const deliverer = new TelemetryDeliverer(database, events, () => repository);
    expect((await deliverer.flush()).degraded).toEqual(['alpha']);
    await deliverer.flush();
    // Operations keep journaling while delivery is down.
    events.record('run_state_changed', { runId: 'run-1', botId: 'alpha' }, { from: 'queued', to: 'running' });
    down = false;
    const report = await deliverer.flush();
    expect(report.pending).toBe(1); // the recovered event itself is still to be delivered
    await deliverer.flush();
    const types = received.map((event) => event.type);
    expect(types.filter((type) => type === 'telemetry_delivery_degraded')).toHaveLength(1);
    expect(types).toEqual(
      expect.arrayContaining(['run_created', 'run_state_changed', 'telemetry_recovered']),
    );
    expect(new Set(received.map((event) => event.eventId)).size).toBe(received.length);
    database.close();
  });

  it('refuses to journal when the database cannot write, so the caller does not mutate', () => {
    const database = openDb();
    const events = journal(database);
    database.close();
    expect(() => events.record('operation_intended', { runId: 'run-1' }, { kind: 'x' })).toThrow(
      expect.objectContaining({ code: 'intent_not_persisted' }),
    );
  });
});
