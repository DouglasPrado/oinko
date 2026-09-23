import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { BotStore, BotManager } from '../src/index.js';
import { BotDefinitionSchema } from '../src/schema.js';
import { runBotCommand } from '../src/commands.js';

const roots: string[] = [];
function root() {
  const dir = mkdtempSync(join(tmpdir(), 'oinko-bots-'));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const definition = {
  id: 'support',
  name: 'Suporte',
  model: 'test-model',
  systemPrompt: 'Ajude a pessoa.',
  cli: true,
  telegram: { enabled: false, allowedUserIds: [] },
  mcps: [],
};

it('keeps conversation search off unless the operator turns it on', () => {
  // Reading old conversations is a new use of personal data: never a silent default.
  expect(BotDefinitionSchema.parse(definition).conversationSearch).toBe(false);
  expect(
    BotDefinitionSchema.parse({ ...definition, conversationSearch: true }).conversationSearch,
  ).toBe(true);
});

it('requires explicit opt-in to allow Telegram private chats without an allowlist', () => {
  const store = new BotStore(root());
  try {
    expect(() =>
      store.save({ ...definition, telegram: { enabled: true, allowedUserIds: [] } }, {}, 0),
    ).toThrow();
    const saved = store.save(
      {
        ...definition,
        telegram: { enabled: true, allowedUserIds: [], allowAllPrivateChats: true },
      },
      {},
      0,
    );
    expect(saved.telegram.allowAllPrivateChats).toBe(true);
  } finally {
    store.close();
  }
});

it('refuses to replace a missing encryption key when a registry already exists', () => {
  const dir = root();
  const store = new BotStore(dir);
  store.save(definition, { apiKey: 'recoverable-with-original-key' }, 0);
  store.close();
  const keyPath = join(dir, '.harness/bots.key');
  rmSync(keyPath);
  expect(() => new BotStore(dir)).toThrow(/chave.*ausente/i);
  expect(existsSync(keyPath)).toBe(false);
});

it('persists definitions and encrypts credentials without returning them to the dashboard', () => {
  const dir = root();
  const store = new BotStore(dir);
  try {
    const saved = store.save(definition, { apiKey: 'private-llm-value' }, 0);
    expect(saved.revision).toBe(1);
    expect(saved.hasApiKey).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('private-llm-value');
    expect(store.runtime('support').secrets.apiKey).toBe('private-llm-value');
    expect(() => store.save({ ...definition, name: 'Outro' }, {}, 0)).toThrow(/alterado/);
    store.save({ ...definition, name: 'Atualizado' }, {}, 1);
    expect(store.runtime('support').secrets.apiKey).toBe('private-llm-value');
    expect(() => store.save({ ...definition, id: '../escape' }, {}, 0)).toThrow();
  } finally {
    store.close();
  }
  expect(
    readFileSync(join(dir, '.harness/bots.db')).includes(Buffer.from('private-llm-value')),
  ).toBe(false);
  const reopened = new BotStore(dir);
  try {
    expect(reopened.get('support').name).toBe('Atualizado');
  } finally {
    reopened.close();
  }
});

it('starts two configured bots through the same worker, reloads a saved revision and stops only one', async () => {
  const dir = root();
  const store = new BotStore(dir);
  const manager = new BotManager(store, {
    workerPath: new URL('../dist/worker.js', import.meta.url),
  });
  try {
    store.save(definition, { apiKey: 'fake-key' }, 0);
    store.save({ ...definition, id: 'sales', name: 'Vendas' }, { apiKey: 'fake-key' }, 0);
    await manager.start('support');
    await manager.start('sales');
    expect((await manager.status('support')).state).toBe('running');
    expect((await manager.status('sales')).state).toBe('running');
    expect(await manager.message('support', 'test', '/help')).toContain('/reset');
    store.save({ ...definition, name: 'Novo nome' }, {}, 1);
    expect((await manager.status('support')).needsRestart).toBe(true);
    await manager.restart('support');
    expect((await manager.status('support')).needsRestart).toBe(false);
    await manager.stop('support');
    expect((await manager.status('support')).state).toBe('stopped');
    expect((await manager.status('sales')).state).toBe('running');
  } finally {
    await manager.stop('support');
    await manager.stop('sales');
    store.close();
  }
}, 30_000);

it('keeps canonical data paths and credentials across edits and reopening', () => {
  const dir = root();
  let store = new BotStore(dir);
  try {
    store.save(definition, { apiKey: 'saved-secret' }, 0);
    const expected = {
      dataDir: join(dir, '.harness/bots/support'),
      telemetryDbPath: join(dir, '.harness/bots/support/telemetry.db'),
    };
    expect(store.runtime('support').paths).toEqual(expected);
    store.save({ ...definition, name: 'Atualizado pela dashboard' }, {}, 1);
    store.close();
    store = new BotStore(dir);
    expect(store.runtime('support').paths).toEqual(expected);
    expect(store.runtime('support').secrets.apiKey).toBe('saved-secret');
    expect(store.get('support')).toMatchObject({ name: 'Atualizado pela dashboard', revision: 2 });
  } finally {
    store.close();
  }
});

it('rejects the retired bot-specific import command without creating a bot', async () => {
  const dir = root();
  await expect(runBotCommand(dir, ['import-oink-lp'])).rejects.toThrow(/Uso:/);
  const store = new BotStore(dir);
  try {
    expect(store.list()).toEqual([]);
  } finally {
    store.close();
  }
});

it('reports missing credentials without leaking data or leaving a running worker', async () => {
  const dir = root();
  const store = new BotStore(dir);
  const manager = new BotManager(store, {
    workerPath: new URL('../dist/worker.js', import.meta.url),
  });
  try {
    store.save(definition, {}, 0);
    await expect(manager.start('support')).rejects.toThrow(/chave da API/);
    expect((await manager.status('support')).state).toBe('stopped');
    store.save(definition, { apiKey: 'fake-key' }, 1);
    await manager.start('support');
    expect((await manager.status('support')).state).toBe('running');
  } finally {
    await manager.stop('support');
    store.close();
  }
});
