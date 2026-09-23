import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentHost, type AgentHostConfig } from '../src/index.js';

const sse = (frames: object[]) =>
  new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: { 'Content-Type': 'text/event-stream' },
  });
const reply = (content: string) =>
  sse([
    { choices: [{ delta: { content }, index: 0 }] },
    {
      choices: [{ finish_reason: 'stop', index: 0 }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ]);
const searchCall = (query: string) =>
  sse([
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: `call-${Math.random()}`,
                function: { name: 'ConversationSearch', arguments: JSON.stringify({ query }) },
              },
            ],
          },
          index: 0,
        },
      ],
    },
    {
      choices: [{ finish_reason: 'tool_calls', index: 0 }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ]);

interface Body {
  messages: { role: string; content: string }[];
  tools?: { function: { name: string } }[];
}

/** Scripted model: "procure" triggers a search; a tool result gets a plain answer. */
function scriptModel() {
  const results: string[] = [];
  const bodies: Body[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Body;
    bodies.push(body);
    const last = body.messages[body.messages.length - 1]!;
    if (last.role === 'tool') {
      results.push(last.content);
      return reply('ok');
    }
    return String(last.content).includes('procure') ? searchCall('marcador') : reply('anotado');
  });
  return { results, bodies };
}

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function hostConfig(conversationSearch?: boolean): AgentHostConfig {
  const dataDir = mkdtempSync(join(tmpdir(), 'oinko-search-'));
  dirs.push(dataDir);
  return {
    id: 'assistant',
    dataDir,
    agent: { apiKey: 'fake', model: 'test' },
    telemetryDbPath: join(dataDir, 'telemetry.db'),
    telemetryEnabled: false,
    capturePayloads: 'none',
    retentionDays: 30,
    ...(conversationSearch !== undefined && { conversationSearch }),
  };
}

describe('conversation search in the product', () => {
  const cli = { channel: 'cli' as const, connectionId: 'local', conversationId: '42' };
  const telegram = { channel: 'telegram' as const, connectionId: 'bot', conversationId: '42' };

  it('is off unless the bot turns it on', async () => {
    const { bodies } = scriptModel();
    const app = createAgentHost(hostConfig());
    try {
      await app.runtime.handle(cli, 'oi');
    } finally {
      await app.close();
    }
    expect((bodies[0]!.tools ?? []).map((t) => t.function.name)).not.toContain(
      'ConversationSearch',
    );
  });

  it('never crosses channels, and forgets what /reset cleared — even after a restart', async () => {
    const { results } = scriptModel();
    const config = hostConfig(true);
    let app = createAgentHost(config);
    try {
      await app.runtime.handle(cli, 'o marcador AZUL fica no CLI');
      await app.runtime.handle(telegram, 'o marcador VERDE fica no Telegram');
      await app.runtime.handle(cli, 'procure o marcador');
      expect(results[0]).toContain('AZUL');
      expect(results[0]).not.toContain('VERDE');

      await app.runtime.handle(cli, '/reset');
      await app.close();
      app = createAgentHost(config);
      await app.runtime.handle(cli, 'procure o marcador');
      expect(results[1]).toMatch(/no matching messages/i);
    } finally {
      await app.close();
    }
  });
});

describe('/memory and data memory never stores', () => {
  it('answers plainly instead of failing when the text holds a CPF', async () => {
    scriptModel();
    const app = createAgentHost(hostConfig());
    try {
      const answer = await app.runtime.handle(
        { channel: 'cli', connectionId: 'local', conversationId: '7' },
        '/memory meu CPF é 529.982.247-25',
      );
      expect(answer).toMatch(/não/i);
      expect(answer).toContain('CPF');
      expect(answer).not.toContain('529.982.247-25');
    } finally {
      await app.close();
    }
  });
});
