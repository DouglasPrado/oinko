// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TelemetryDatabase } from '@oinko/core';
import { BotStore } from '@oinko/bots/store';

const holder = vi.hoisted(() => ({ store: undefined as BotStore | undefined }));
vi.mock('@/server/bots/manager', () => ({ botManager: () => ({ store: holder.store }) }));
let root: string;
let configuredPath: string;
const definition = { name: 'Bot', model: 'test', systemPrompt: 'Ajude.' };
function seed(path: string, text: string, tokens: number) {
  const schema = new TelemetryDatabase(path);
  schema.initialize();
  schema.close();
  const db = new DatabaseSync(path);
  db.prepare(
    `INSERT INTO executions (trace_id,thread_id,model,provider_kind,status,total_tokens,started_at)
    VALUES ('same-trace','same-thread','test','openrouter','ok',?,1000)`,
  ).run(tokens);
  db.prepare(
    `INSERT INTO payloads (id,size_bytes,preview,redacted,body,created_at)
    VALUES ('same-payload',?,?,1,?,1000)`,
  ).run(text.length, text, text);
  db.close();
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'telemetry-sources-'));
  holder.store = new BotStore(root);
  configuredPath = join(root, '.harness/bots/landing/telemetry.db');
  vi.stubEnv('TELEMETRY_DB_PATH', configuredPath);
  vi.resetModules();
});
afterEach(() => {
  const key = Symbol.for('@oinko/dashboard/telemetry-databases');
  const connections = (globalThis as Record<symbol, unknown>)[key] as
    Map<string, DatabaseSync> | undefined;
  for (const db of connections?.values() ?? []) db.close();
  delete (globalThis as Record<symbol, unknown>)[key];
  holder.store?.close();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

it('discovers bots and isolates threads, details and payloads across their databases', async () => {
  holder.store!.save({ ...definition, id: 'landing', name: 'Landing' }, {}, 0);
  holder.store!.save({ ...definition, id: 'dev', name: 'Dev' }, {}, 0);
  seed(configuredPath, 'landing payload', 10);
  seed(join(root, '.harness/bots/dev/telemetry.db'), 'dev payload', 20);
  const { selectTelemetry } = await import('@/server/repositories/telemetry-sources');
  const { listThreads } = await import('@/server/repositories/thread-repository');
  const { getExecutionDetail } = await import('@/server/repositories/execution-repository');
  const { getPayloadChunk } = await import('@/server/repositories/payload-repository');
  const landing = selectTelemetry()!;
  const dev = selectTelemetry('dev')!;
  expect(landing.id).toBe('landing');
  expect(dev.options).toEqual([
    { id: 'dev', name: 'Dev' },
    { id: 'landing', name: 'Landing' },
  ]);
  expect(dev.database).not.toBe(landing.database);
  expect(selectTelemetry('dev')!.database).toBe(dev.database);
  const filters = { q: '', model: '', status: 'all' as const };
  expect(listThreads(filters, dev.database)[0]?.totalTokens).toBe(20);
  expect(listThreads(filters, landing.database)[0]?.totalTokens).toBe(10);
  expect(getExecutionDetail('same-trace', dev.database)?.execution.totalTokens).toBe(20);
  expect(getPayloadChunk('same-payload', 0, 100, dev.database)?.chunk).toBe('dev payload');
  expect(getPayloadChunk('same-payload', 0, 100, landing.database)?.chunk).toBe('landing payload');
});

it('shows an unstarted bot without creating its database and rejects unknown sources', async () => {
  holder.store!.save({ ...definition, id: 'new-bot' }, {}, 0);
  const { selectTelemetry } = await import('@/server/repositories/telemetry-sources');
  const selected = selectTelemetry('new-bot')!;
  expect(selected.database).toBeUndefined();
  expect(selected.emptyMessage).toContain('Inicie');
  expect(existsSync(join(root, '.harness/bots/new-bot/telemetry.db'))).toBe(false);
  expect(selectTelemetry('unknown')).toBeUndefined();
  expect(selectTelemetry('../../bots.db')).toBeUndefined();
});

it('keeps the configured SDK database available without registered bots', async () => {
  seed(configuredPath, 'standalone', 5);
  const { selectTelemetry } = await import('@/server/repositories/telemetry-sources');
  expect(selectTelemetry()).toMatchObject({ id: '', name: 'Outras conversas' });
  expect(selectTelemetry()!.database).toBeDefined();
});

it('preserves requested and effective models when reading routed executions', async () => {
  seed(configuredPath, 'routing', 10);
  const db = new DatabaseSync(configuredPath);
  try {
    db.prepare(
      "UPDATE executions SET requested_model = ?, model = ? WHERE trace_id = 'same-trace'",
    ).run('minimax/minimax-m3', 'nvidia/nemotron-3-ultra-550b-a55b:free');
    const { listExecutions, getExecutionDetail } =
      await import('@/server/repositories/execution-repository');
    for (const execution of [
      listExecutions('same-thread', db)[0],
      getExecutionDetail('same-trace', db)?.execution,
    ]) {
      expect(execution).toMatchObject({
        requestedModel: 'minimax/minimax-m3',
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      });
    }
  } finally {
    db.close();
  }
});
