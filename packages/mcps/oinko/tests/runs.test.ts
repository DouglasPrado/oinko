/* eslint-disable @typescript-eslint/no-explicit-any -- structured MCP results are untyped JSON */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { RunnerState } from '@oinko/environments/client';
import { BotStore } from '@oinko/bots/store';
import { ChannelCommands, readJournal } from '@oinko/agent-runtime/programming';
import { OINKO_MCP_TOOLS, openProgramming } from '@oinko/bots/programming';
import { WorkspaceStore } from '@oinko/workspaces';
import { createOinkoServer } from '../src/index.js';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

const runner = {
  async state(): Promise<RunnerState> {
    return { pid: 1, projects: [], environments: [], tasks: [], jobs: [], previews: [], sandboxes: {} };
  },
  async command(): Promise<unknown> {
    return {};
  },
};

function installation() {
  const root = mkdtempSync(join(tmpdir(), 'oinko-mcp-runs-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const bots = new BotStore(root);
  for (const id of ['alpha', 'beta'])
    bots.save({ id, name: id, model: 'm', systemPrompt: 'p', programmingPolicy: { enabled: true } }, { apiKey: 'sk-mcp-0123456789abcdef' }, 0);
  bots.close();
  const workspaces = new WorkspaceStore(root);
  workspaces.saveProject({ id: 'loja', name: 'Loja', repositories: [{ id: 'app', source: 'https://example.com/a.git' }], allowedBotIds: ['alpha', 'beta'] }, 0);
  workspaces.saveProject({ id: 'interno', name: 'Interno', repositories: [{ id: 'app', source: 'https://example.com/b.git' }], allowedBotIds: ['alpha'] }, 0);
  workspaces.close();
  return root;
}

async function connect(root: string, botId?: string) {
  const server = createOinkoServer({ root, client: runner, ...(botId && { botId }) });
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  cleanup.push(async () => {
    await client.close();
    await server.close();
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { error: result.isError === true, data: result.structuredContent as any };
  };
  return { client, call };
}

describe('Oinko MCP run tools', () => {
  it('registers exactly the tools the bots equivalence map knows about', async () => {
    const { client } = await connect(installation());
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(names).toEqual([...OINKO_MCP_TOOLS].sort());
  });

  it('starts without waiting, lists, controls and explains runs through the shared service', async () => {
    const root = installation();
    const { call } = await connect(root);
    const started = await call('oinko_run_start', { botId: 'alpha', projectId: 'loja', request: 'Corrigir frete' });
    expect(started.error).toBe(false);
    expect(started.data).toMatchObject({ state: 'queued', queuePosition: 0, runId: expect.stringMatching(/^run-/) });
    const runId = started.data.runId as string;
    expect((await call('oinko_runs', { botId: 'alpha' })).data.items.map((item: any) => item.id)).toEqual([runId]);
    const detail = await call('oinko_run', { runId });
    expect(detail.data.run).toMatchObject({ id: runId, state: 'queued' });
    expect(detail.data.criteria.map((criterion: any) => criterion.id)).toEqual(['changes', 'checks']);
    expect(detail.data.timeline.entries.map((entry: any) => entry.type)).toContain('run_created');
    const paused = await call('oinko_run_control', { runId, action: 'pause' });
    expect(paused.data).toMatchObject({ status: 'requested', state: 'queued' });
    const cancelled = await call('oinko_run_control', { runId, action: 'cancel' });
    expect(cancelled.data).toMatchObject({ status: 'applied', state: 'cancelled' });
    expect((await call('oinko_run_explain', { runId })).data.state).toBe('cancelled');
    const observer = openProgramming({ root, producer: 'observer' });
    try {
      const calls = readJournal(observer.database, { runId, type: 'mcp_call_finished' }).map((event) => event.envelope.payload?.tool);
      expect(calls).toEqual(expect.arrayContaining(['oinko_run', 'oinko_run_control', 'oinko_run_explain']));
    } finally {
      await observer.close();
    }
  });

  it('acts only as its bot when scoped, without administrative tools or other bots’ runs', async () => {
    const root = installation();
    const admin = await connect(root);
    const other = (await admin.call('oinko_run_start', { botId: 'beta', projectId: 'loja', request: 'Trabalho do beta' })).data.runId;
    const alpha = await connect(root, 'alpha');
    const names = (await alpha.client.listTools()).tools.map((tool) => tool.name);
    for (const adminTool of ['oinko_bots', 'oinko_update_bot', 'oinko_configure_project', 'oinko_configure_environment', 'oinko_configure_network', 'oinko_prepare_project'])
      expect(names).not.toContain(adminTool);
    expect(names).toContain('oinko_run_start');
    expect((await alpha.call('oinko_run_start', { botId: 'beta', projectId: 'loja', request: 'x' })).error).toBe(true);
    const own = await alpha.call('oinko_run_start', { botId: 'alpha', projectId: 'interno', request: 'Trabalho do alpha' });
    expect(own.error).toBe(false);
    expect((await alpha.call('oinko_runs', {})).data.items.map((item: any) => item.botId)).toEqual(['alpha']);
    const guessed = await alpha.call('oinko_run', { runId: other });
    expect(guessed.error).toBe(true);
    expect(JSON.stringify(guessed.data)).toMatch(/não encontrado/);
    expect((await alpha.call('oinko_run_control', { runId: other, action: 'cancel' })).error).toBe(true);
  });

  it('gives the same result for an equivalent operation from MCP, a channel and the dashboard service', async () => {
    const root = installation();
    const { call } = await connect(root);
    const runtime = openProgramming({ root, producer: 'dashboard-test' });
    cleanup.push(() => runtime.close());
    const commands = new ChannelCommands({ botId: 'alpha', service: runtime.service, queries: runtime.queries, access: runtime.access });
    const route = { channel: 'telegram', connectionId: 'bot', conversationId: '42' };
    const reply = commands.handle(route, '/tarefa loja Ajustar layout do checkout');
    const channelRun = runtime.store.listRuns({ botId: 'alpha' }).items[0]!;
    expect(reply).toContain(channelRun.id.slice(4, 12));
    // MCP (administrator) sees and pauses the run a chat started.
    expect((await call('oinko_run_control', { runId: channelRun.id, action: 'pause' })).data.status).toBe('requested');
    expect(commands.handle(route, '/status')).toMatch(/pausa solicitada/);
    // The dashboard service sees the same persisted request.
    expect(runtime.queries.detail({ kind: 'operator', id: 'dashboard' }, channelRun.id).run.pendingControls).toEqual(['pause']);
    // Another chat of the same bot cannot control it.
    expect(commands.handle({ ...route, conversationId: '99' }, `/cancel ${channelRun.id.slice(4, 12)}`)).toMatch(/não encontrado/);
  });

  it('updates the durable programming policy with a revision and records the capability change', async () => {
    const root = installation();
    const { call } = await connect(root);
    const current = (await call('oinko_bots', { botId: 'beta' })).data.bots[0];
    const updated = await call('oinko_update_bot', {
      botId: 'beta',
      revision: current.revision,
      changes: { programmingPolicy: { enabled: false } },
    });
    expect(updated.error).toBe(false);
    expect(updated.data.bot.programmingPolicy.enabled).toBe(false);
    expect((await call('oinko_run_start', { botId: 'beta', projectId: 'loja', request: 'x' })).error).toBe(true);
    const stale = await call('oinko_update_bot', { botId: 'beta', revision: current.revision, changes: { programmingPolicy: { enabled: true } } });
    expect(stale.error).toBe(true);
    const observer = openProgramming({ root, producer: 'observer' });
    try {
      const capability = readJournal(observer.database, { type: 'capability_changed' }).map((event) => event.envelope.payload);
      expect(capability).toEqual([expect.objectContaining({ capability: 'programming', action: 'disabled' })]);
      expect(readJournal(observer.database, { type: 'bot_configuration_changed' })[0]?.envelope.payload?.fields).toContain('programmingPolicy.enabled');
    } finally {
      await observer.close();
    }
  });
});
