import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { BotManager, BotStore } from '../src/index.js';
import { crashLine } from '../src/crash-log.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('describes a crash with its kind and time, never with a secret of the bot', () => {
  const line = crashLine('unhandledRejection', new Error('fetch failed for token 123456:ABCDEF-secret'), ['123456:ABCDEF-secret'], new Date('2026-09-25T03:00:00Z'));
  expect(line).toMatch(/^2026-09-25T03:00:00.000Z rejeição não tratada: Error: fetch failed for token \[redigido\]/);
  expect(line).not.toContain('ABCDEF-secret');
  expect(crashLine('uncaughtException', 'boom', [])).toContain('exceção não capturada: boom');
});

it('keeps what the worker prints in the bot worker.log instead of discarding it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oinko-worker-log-'));
  roots.push(dir);
  const store = new BotStore(dir);
  store.save({ id: 'dev', name: 'Dev', model: 'main-model', systemPrompt: 'Você é o Dev.' }, { apiKey: 'sk-test-0123456789abcdef' }, 0);
  // A worker that reports ready, prints a failure and exits: what a crash looks like from outside.
  const worker = join(dir, 'fake-worker.mjs');
  writeFileSync(worker, "process.send({ ready: true }); console.error('rejeição não tratada: falha simulada'); setTimeout(() => process.exit(1), 50);\n");
  await new BotManager(store, { workerPath: pathToFileURL(worker) }).start('dev').catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const log = readFileSync(join(store.runtime('dev').paths.dataDir, 'worker.log'), 'utf8');
  store.close();
  expect(log).toContain('falha simulada');
});
