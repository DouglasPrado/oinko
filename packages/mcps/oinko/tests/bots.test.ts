import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BotStore, BotManager } from '@oinko/bots';

type Fixture = { root: string; store: BotStore; manager: BotManager; client: Client };
const fixtures: Fixture[] = [];
async function fixture(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'oinko-mcp-bots-'));
  const store = new BotStore(root);
  const manager = new BotManager(store, {
    workerPath: new URL('../../../bots/dist/worker.js', import.meta.url),
  });
  store.save(
    {
      id: 'dev',
      name: 'Dev',
      model: 'old-model',
      systemPrompt: 'Original instructions',
      programming: true,
      conversationSearch: true,
      cli: false,
      telegram: { enabled: false, allowedUserIds: ['42'] },
      telemetry: { enabled: false, capture: 'none', retentionDays: 7 },
      mcps: [{ id: 'remote', url: 'https://example.com/mcp', enabled: false }],
    },
    {
      apiKey: 'stored-api-secret',
      telegramToken: 'stored-telegram-secret',
      mcpTokens: { remote: 'stored-mcp-secret' },
    },
    0,
  );
  const client = new Client({ name: 'bot-admin-test', version: '1' });
  const result = { root, store, manager, client };
  fixtures.push(result);
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [new URL('../dist/cli.js', import.meta.url).pathname, '--root', root],
      stderr: 'pipe',
    }),
  );
  return result;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.client.close();
    await f.manager.stop('dev');
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

it('reads the shared registry without exposing stored credentials', async () => {
  const { client } = await fixture();
  for (const args of [{}, { botId: 'dev' }]) {
    const result = await client.callTool({ name: 'oinko_bots', arguments: args });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      bots: [{ id: 'dev', revision: 1, hasApiKey: true, status: { state: 'stopped' } }],
    });
    expect(JSON.stringify(result)).not.toMatch(/stored-(api|telegram|mcp)-secret/);
  }
});

it('merges partial settings without changing omitted defaults, credentials or paths', async () => {
  const { client, store } = await fixture();
  const before = store.runtime('dev');
  const result = await client.callTool({
    name: 'oinko_update_bot',
    arguments: {
      botId: 'dev',
      revision: 1,
      changes: {
        model: 'minimax/minimax-m3',
        baseUrl: 'https://openrouter.ai/api/v1',
        systemPrompt: 'Updated instructions',
        telegram: { allowAllPrivateChats: true },
        telemetry: { retentionDays: 14 },
      },
    },
  });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    saved: true,
    activation: 'next_start',
    bot: { id: 'dev', revision: 2 },
  });
  const after = store.runtime('dev');
  expect(after.definition).toEqual({
    ...before.definition,
    model: 'minimax/minimax-m3',
    baseUrl: 'https://openrouter.ai/api/v1',
    systemPrompt: 'Updated instructions',
    telegram: { ...before.definition.telegram, allowAllPrivateChats: true },
    telemetry: { ...before.definition.telemetry, retentionDays: 14 },
  });
  expect(after.secrets).toEqual(before.secrets);
  expect(after.paths).toEqual(before.paths);
});

it('rejects stale revisions, missing bots, unknown fields and invalid merged definitions without writing', async () => {
  const { client, store } = await fixture();
  const before = store.runtime('dev');
  for (const args of [
    { botId: 'dev', revision: 0, changes: { name: 'Changed' } },
    { botId: 'dev', revision: 2, changes: { name: 'Changed' } },
    { botId: 'missing', revision: 1, changes: { name: 'Changed' } },
    { botId: 'dev', revision: 1, changes: { id: 'renamed' } },
    { botId: 'dev', revision: 1, changes: { typo: 'ignored' } },
    { botId: 'dev', revision: 1, changes: { telegram: { enabled: true, allowedUserIds: [] } } },
    {
      botId: 'dev',
      revision: 1,
      changes: {
        mcps: [
          { id: 'same', url: 'https://example.com' },
          { id: 'same', url: 'https://example.com' },
        ],
      },
    },
    { botId: 'dev', revision: 1, changes: {} },
  ]) {
    const result = await client.callTool({ name: 'oinko_update_bot', arguments: args });
    expect(result.isError).toBe(true);
    expect(store.runtime('dev')).toEqual(before);
  }
  expect(store.has('missing')).toBe(false);
});

it('writes new credentials without echoing them and clears optional settings explicitly', async () => {
  const { client, store } = await fixture();
  const current = store.get('dev');
  store.save(
    { ...current, baseUrl: 'https://example.com/api', transcriptionModel: 'custom' },
    {},
    1,
  );
  const result = await client.callTool({
    name: 'oinko_update_bot',
    arguments: {
      botId: 'dev',
      revision: 2,
      changes: {
        baseUrl: null,
        transcriptionModel: null,
        intelligence: { enabled: true, fastModel: 'qwen/qwen3.8-27b:free' },
      },
      credentials: {
        apiKey: 'new-private-key',
        typesafeKey: 'new-private-jev',
        mcpTokens: { remote: 'new-private-token' },
      },
    },
  });
  expect(result.isError).not.toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/new-private|stored-.*-secret/);
  expect(store.runtime('dev').secrets).toMatchObject({
    apiKey: 'new-private-key',
    typesafeKey: 'new-private-jev',
    telegramToken: 'stored-telegram-secret',
    mcpTokens: { remote: 'new-private-token' },
  });
  expect(store.get('dev').intelligence).toEqual({
    enabled: true,
    fastModel: 'qwen/qwen3.8-27b:free',
    minConfidence: 0.85,
  });
  expect(store.get('dev').baseUrl).toBeUndefined();
  expect(store.get('dev').transcriptionModel).toBeUndefined();
});

it('leaves a live bot running on its old revision and reports restart_required', async () => {
  const { client, manager } = await fixture();
  await manager.start('dev');
  const result = await client.callTool({
    name: 'oinko_update_bot',
    arguments: {
      botId: 'dev',
      revision: 1,
      changes: { model: 'new-model' },
    },
  });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    activation: 'restart_required',
    bot: { revision: 2 },
    status: { state: 'running', revision: 1, needsRestart: true },
  });
  expect(await manager.status('dev')).toMatchObject({
    state: 'running',
    revision: 1,
    needsRestart: true,
  });
  await manager.restart('dev');
  const query = await client.callTool({ name: 'oinko_bots', arguments: { botId: 'dev' } });
  expect(query.structuredContent).toMatchObject({
    bots: [{ revision: 2, status: { state: 'running', revision: 2, needsRestart: false } }],
  });
}, 30_000);
