import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { createAgent } from '../src/agent-factory.js';
import { readConfig } from '../src/config.js';

afterEach(() => vi.restoreAllMocks());

it('persists history across restarts and keeps Telegram separate from CLI', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'oinko-agent-'));
  const requests: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    requests.push(String(init?.body));
    return new Response(
      'data: {"choices":[{"delta":{"content":"resposta"},"index":0}]}\n\ndata: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  });
  const config = readConfig(
    { HIGGSFIELD: 'off', LLM_API_KEY: 'fake', AGENT_MODEL: 'test', AGENT_DATA_DIR: directory },
    ['cli'],
  );
  const route = { channel: 'cli' as const, connectionId: 'local', conversationId: '42' };
  let app = createAgent(config);
  try {
    const telemetry = new DatabaseSync(join(config.dataDir, 'telemetry.db'), { readOnly: true });
    try {
      expect(telemetry.prepare('SELECT COUNT(*) AS count FROM executions').get()).toMatchObject({
        count: 0,
      });
    } finally {
      telemetry.close();
    }
    await app.runtime.handle(route, 'marcador exclusivo CLI');
    await app.close();
    app = createAgent(config);
    await app.runtime.handle(route, 'continuação');
    expect(requests.at(-1)).toContain('marcador exclusivo CLI');
    await app.runtime.handle({ ...route, channel: 'telegram' }, 'outra conversa');
    expect(requests.at(-1)).not.toContain('marcador exclusivo CLI');
    const recorded = new DatabaseSync(join(config.dataDir, 'telemetry.db'), { readOnly: true });
    try {
      const rows = recorded.prepare('SELECT app, thread_id FROM executions').all();
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.app === 'oink-lp')).toBe(true);
      expect(new Set(rows.map((row) => row.thread_id)).size).toBe(2);
    } finally {
      recorded.close();
    }
    await app.runtime.handle(route, '/reset');
    await app.close();
    app = createAgent(config);
    await app.runtime.handle(route, 'nova conversa');
    expect(requests.at(-1)).not.toContain('marcador exclusivo CLI');
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
