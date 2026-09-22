import { describe, expect, it, vi } from 'vitest';
import { AgentRuntime, threadIdFor } from '@oinko/agent-runtime';
import { readConfig } from '../src/config.js';

describe('multi-channel agent', () => {
  it('isolates agent, connection, channel and conversation without delimiter collisions', () => {
    const route = { channel: 'cli' as const, connectionId: 'local', conversationId: '42' };
    expect(
      new Set([
        threadIdFor('oinko', route),
        threadIdFor('oinko', { ...route, channel: 'telegram' }),
        threadIdFor('other', route),
        threadIdFor('oinko', { ...route, connectionId: 'other' }),
        threadIdFor('oinko', { ...route, connectionId: 'local:42', conversationId: 'a' }),
        threadIdFor('oinko', { ...route, conversationId: '42:a' }),
      ]).size,
    ).toBe(6);
  });

  it('routes both channels to the same agent and scopes reset and memory', async () => {
    const agent = {
      chat: vi.fn().mockResolvedValue('resposta'),
      clearHistory: vi.fn(),
      transcribe: vi.fn(),
      remember: vi.fn().mockResolvedValue('memory.md'),
      getUsage: vi.fn().mockReturnValue({ totalTokens: 12 }),
    };
    const runtime = new AgentRuntime('oinko', agent);
    const cli = { channel: 'cli' as const, connectionId: 'local', conversationId: '42' };
    const telegram = { ...cli, channel: 'telegram' as const };
    await runtime.handle(cli, 'oi');
    await runtime.handle(telegram, 'olá');
    expect(agent.chat.mock.calls.map((call) => call[1].threadId)).toEqual([
      threadIdFor('oinko', cli),
      threadIdFor('oinko', telegram),
    ]);
    await runtime.handle(telegram, '/reset');
    expect(agent.clearHistory).toHaveBeenCalledWith(threadIdFor('oinko', telegram));
    await runtime.handle(cli, '/memory prefiro português');
    expect(agent.remember).toHaveBeenCalledWith('prefiro português', threadIdFor('oinko', cli));
    expect(agent.chat).toHaveBeenCalledTimes(2);
  });

  it('configures the agent independently of channel credentials', () => {
    const env = { HIGGSFIELD: 'off', LLM_API_KEY: 'test', AGENT_MODEL: 'test-model' };
    expect(readConfig(env).AGENT_ID).toBe('oink-lp');
    expect(readConfig(env)).not.toHaveProperty('mode');
    expect(() => readConfig({ ...env, LLM_API_KEY: '' })).toThrow(/LLM_API_KEY/);
  });

  it('orders commands after active turns and recovers the queue after errors', async () => {
    let finish!: (value: string) => void;
    const agent = {
      chat: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              finish = resolve;
            }),
        )
        .mockRejectedValueOnce(new Error('failure'))
        .mockResolvedValue('ok'),
      clearHistory: vi.fn(),
      transcribe: vi.fn(),
      remember: vi.fn(),
      getUsage: vi.fn(),
    };
    const runtime = new AgentRuntime('oinko', agent);
    const route = { channel: 'cli' as const, connectionId: 'local', conversationId: 'default' };
    const first = runtime.handle(route, 'first');
    const reset = runtime.handle(route, '/reset');
    await Promise.resolve();
    expect(agent.clearHistory).not.toHaveBeenCalled();
    finish('done');
    await Promise.all([first, reset]);
    expect(agent.clearHistory).toHaveBeenCalledTimes(1);
    await expect(runtime.handle(route, 'fail')).rejects.toThrow('failure');
    await expect(runtime.handle(route, 'retry')).resolves.toBe('ok');
    const aborted = new AbortController();
    aborted.abort();
    await expect(runtime.handle(route, 'cancelled', aborted.signal)).rejects.toThrow();
    expect(agent.chat).toHaveBeenCalledTimes(3);
  });
});
