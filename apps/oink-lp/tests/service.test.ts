import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { expect, it, vi } from 'vitest';
import {
  AgentRuntime,
  controlRequest,
  readConnections,
  startAgentService,
  type ServiceOptions,
  type ChannelProvider,
  type Connections,
} from '@oinko/agent-runtime';
import { attachCli, cliChannel } from '@oinko/channel-cli';

it('keeps its socket reserved until channel shutdown finishes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oinko-shutdown-'));
  const socketPath = join(dir, 'agent.sock');
  let release!: () => void;
  let aborted!: () => void;
  const draining = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stopping = new Promise<void>((resolve) => {
    aborted = resolve;
  });
  const options: ServiceOptions = {
    socketPath,
    createHost: (() => ({
      runtime: { name: 'test' },
      close: async () => {},
    })) as ServiceOptions['createHost'],
    loadConnections: async () => ({
      channels: [{ id: 'slow', type: 'slow', enabled: true, options: {} }],
      mcps: [],
    }),
    channels: {
      slow: async (_options, context) => {
        context.ready();
        await new Promise<void>((resolve) =>
          context.signal.addEventListener(
            'abort',
            () => {
              aborted();
              resolve();
            },
            { once: true },
          ),
        );
        await draining;
      },
    },
  };
  const service = await startAgentService(options);
  try {
    await controlRequest(socketPath, '/stop', {});
    await stopping;
    await expect(controlRequest(socketPath, '/status')).resolves.toHaveProperty('agentId', 'test');
    await expect(startAgentService(options)).rejects.toThrow(/já está rodando/);
  } finally {
    release();
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it('starts once, shares the agent between channels, reloads providers and survives CLI exit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oinko-service-'));
  const socketPath = join(dir, 'agent.sock');
  const agent = {
    chat: vi.fn().mockResolvedValue('answer'),
    clearHistory: vi.fn(),
    transcribe: vi.fn(),
    remember: vi.fn(),
    getUsage: vi.fn(),
    connectMCP: vi.fn().mockResolvedValue(undefined),
    disconnectMCP: vi.fn().mockResolvedValue(undefined),
  };
  const runtime = new AgentRuntime('test', agent);
  const close = vi.fn().mockResolvedValue(undefined);
  const createHost = vi.fn(() => ({
    agent,
    runtime,
    close,
  })) as unknown as ServiceOptions['createHost'];
  let config: Connections = {
    channels: [
      { id: 'local', type: 'cli', enabled: true, options: {} },
      { id: 'other', type: 'custom', enabled: true, options: {} },
    ],
    mcps: [
      { id: 'tools', type: 'mcp', enabled: true, options: { transport: 'stdio', command: 'fake' } },
    ],
  };
  const custom: ChannelProvider = async (_options, context) => {
    expect(context.runtime).toBe(runtime);
    await context.runtime.handle(
      { channel: 'custom', connectionId: context.id, conversationId: '42' },
      'custom message',
    );
    await cliChannel({}, context);
  };
  const options: ServiceOptions = {
    socketPath,
    createHost,
    loadConnections: async () => config,
    channels: { cli: cliChannel, custom },
  };
  const service = await startAgentService(options);
  try {
    await vi.waitFor(() =>
      expect(service.status().every((entry) => entry.state === 'connected')).toBe(true),
    );
    await expect(startAgentService(options)).rejects.toThrow(/já está rodando/);
    expect(createHost).toHaveBeenCalledTimes(1);
    const sink = () =>
      new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      });
    await Promise.all(
      ['one', 'two'].map((session) =>
        attachCli(
          socketPath,
          session,
          new AbortController().signal,
          'local',
          Readable.from(['hello\n/exit\n']),
          sink(),
        ),
      ),
    );
    expect(agent.chat).toHaveBeenCalledTimes(3);
    expect(new Set(agent.chat.mock.calls.map((call) => call[1].threadId)).size).toBe(3);
    const before = await controlRequest<{ pid: number }>(socketPath, '/status');
    config = {
      channels: [
        { id: 'local', type: 'cli', enabled: true, options: {} },
        { id: 'third', type: 'custom', enabled: true, options: {} },
      ],
      mcps: [],
    };
    await controlRequest(socketPath, '/reload', {});
    expect(agent.disconnectMCP).toHaveBeenCalledWith('tools');
    expect(service.status().map((entry) => entry.id)).toEqual(['local', 'third']);
    const after = await controlRequest<{ pid: number }>(socketPath, '/status');
    expect(after.pid).toBe(before.pid);
    expect(createHost).toHaveBeenCalledTimes(1);
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
  expect(close).toHaveBeenCalledTimes(1);
});

it('isolates a failed provider and keeps credentials out of status', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oinko-service-'));
  const configFile = join(dir, 'connections.json');
  await writeFile(
    configFile,
    JSON.stringify({
      channels: [
        { id: 'local', type: 'cli' },
        { id: 'broken', type: 'broken', options: { token: { env: 'TOKEN' } } },
      ],
    }),
  );
  const agent = {
    chat: vi.fn(),
    clearHistory: vi.fn(),
    transcribe: vi.fn(),
    remember: vi.fn(),
    getUsage: vi.fn(),
  };
  const runtime = new AgentRuntime('test', agent);
  const service = await startAgentService({
    socketPath: join(dir, 'agent.sock'),
    createHost: (() => ({
      agent,
      runtime,
      close: async () => {},
    })) as unknown as ServiceOptions['createHost'],
    loadConnections: () => readConnections(configFile, { TOKEN: 'secret-value' }),
    channels: {
      cli: cliChannel,
      broken: async () => {
        throw new Error('secret-value');
      },
    },
  });
  try {
    await vi.waitFor(() =>
      expect(service.status().find((entry) => entry.id === 'broken')?.state).toBe('error'),
    );
    expect(JSON.stringify(service.status())).not.toContain('secret-value');
    await expect(
      controlRequest(join(dir, 'agent.sock'), '/message', { sessionId: 'one', text: '/help' }),
    ).resolves.toHaveProperty('answer');
    await writeFile(
      configFile,
      '{"channels":[{"id":"same","type":"cli"},{"id":"same","type":"cli"}]}',
    );
    await expect(controlRequest(join(dir, 'agent.sock'), '/reload', {})).rejects.toThrow();
    expect(service.status().find((entry) => entry.id === 'local')?.state).toBe('connected');
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
