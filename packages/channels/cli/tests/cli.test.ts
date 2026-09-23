import { Readable, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/index.js';
import { AgentRuntime, threadIdFor } from '@oinko/agent-runtime';

function fixture() {
  const agent = {
    chat: vi.fn().mockResolvedValue('Olá!'),
    clearHistory: vi.fn(),
    transcribe: vi.fn(),
    remember: vi.fn(),
    getUsage: vi.fn(),
  };
  return { agent, runtime: new AgentRuntime('oinko', agent) };
}

afterEach(() => vi.restoreAllMocks());

describe('CLI adapter', () => {
  it('accepts piped CLI input in order and exits without sending /exit to the model', async () => {
    const { runtime, agent } = fixture();
    let output = '';
    await runCli(
      runtime,
      'work',
      new AbortController().signal,
      Readable.from(['oi\n/reset\n/exit\nnão enviar\n']),
      new Writable({
        write(chunk, _encoding, callback) {
          output += chunk.toString();
          callback();
        },
      }),
    );
    expect(agent.chat).toHaveBeenCalledTimes(1);
    expect(agent.clearHistory).toHaveBeenCalledWith(
      threadIdFor('oinko', { channel: 'cli', connectionId: 'local', conversationId: 'work' }),
    );
    expect(output).toContain('Olá!');
  });
});
