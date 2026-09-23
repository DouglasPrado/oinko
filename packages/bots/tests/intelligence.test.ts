import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { BotStore, BotManager } from '../src/index.js';
import { runBot } from '../src/runner.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'oinko-jev-'));
  roots.push(root);
  const store = new BotStore(root);
  store.save(
    {
      id: 'dev',
      name: 'Dev',
      model: 'minimax/minimax-m3',
      systemPrompt: 'Responda brevemente.',
      baseUrl: 'https://openrouter.ai/api/v1',
      intelligence: { enabled, fastModel: 'qwen/qwen3.8-27b:free', minConfidence: 0.85 },
    },
    { apiKey: 'openrouter-private-key', typesafeKey: 'typesafe-private-key' },
    0,
  );
  return { root, store, manager: new BotManager(store) };
}

it.each([
  ['fast', 0.98, true, 'qwen/qwen3.8-27b:free'],
  ['capable', 0.98, true, 'minimax/minimax-m3'],
  ['fast', 0.3, true, 'minimax/minimax-m3'],
  ['failure', 1, true, 'minimax/minimax-m3'],
  ['fast', 0.98, false, 'minimax/minimax-m3'],
] as const)(
  'routes with Jev (%s, %s, enabled=%s) and records the decision',
  async (tier, confidence, enabled, model) => {
    const { store, manager } = fixture(enabled);
    const models: string[] = [];
    const decisions: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.includes('/systemone')) {
        expect(request.url).toBe('https://api.typesafe.ai/v1/systemone');
        expect(request.headers.get('authorization')).toBe('Bearer typesafe-private-key');
        const body = (await request.json()) as { questions: Record<string, { type: string }> };
        decisions.push(...Object.keys(body.questions));
        if (tier === 'failure') return new Response('{}', { status: 403 });
        return Response.json({
          answers: Object.fromEntries(
            Object.entries(body.questions).map(([key, question]) => [
              key,
              question.type === 'choice'
                ? { type: 'choice', choice: tier, confidence }
                : { type: 'noul', noul: 0.01 },
            ]),
          ),
        });
      }
      expect(request.url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(request.headers.get('authorization')).toBe('Bearer openrouter-private-key');
      const body = (await request.json()) as { model: string };
      models.push(body.model);
      return new Response(
        'data: {"choices":[{"delta":{"content":"ok"},"index":0}]}\n\n' +
          'data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
      );
    });
    const service = await runBot(store, 'dev', () => {});
    try {
      expect(await manager.message('dev', 'routing-test', 'Obrigado, bom dia!')).toBe('ok');
    } finally {
      await service.close();
    }
    try {
      expect(models[0]).toBe(model);
      expect(decisions.includes('tier')).toBe(enabled);
      const db = new DatabaseSync(store.runtime('dev').paths.telemetryDbPath, { readOnly: true });
      try {
        const rows = db.prepare("SELECT point FROM decisions WHERE point='model_routing'").all();
        expect(rows.length).toBe(enabled ? 1 : 0);
      } finally {
        db.close();
      }
      const saved = store.get('dev');
      store.save({ ...saved, name: 'Edited through dashboard' }, {}, saved.revision);
      expect(store.runtime('dev').secrets).toMatchObject({ typesafeKey: 'typesafe-private-key' });
      expect(store.get('dev')).toMatchObject({ hasTypesafeKey: true, intelligence: { enabled } });
      expect(JSON.stringify(store.get('dev'))).not.toContain('typesafe-private-key');
      expect(
        readFileSync(join(store.root, '.harness/bots.db')).includes(
          Buffer.from('typesafe-private-key'),
        ),
      ).toBe(false);
    } finally {
      store.close();
    }
  },
);

it('rejects an enabled Jev without its own credential before opening channels', async () => {
  const { store } = fixture();
  store.save(
    {
      id: 'missing',
      name: 'Missing key',
      model: 'model',
      systemPrompt: 'Test',
      intelligence: { enabled: true },
    },
    { apiKey: 'llm-key' },
    0,
  );
  let service: Awaited<ReturnType<typeof runBot>> | undefined;
  try {
    await expect(
      runBot(store, 'missing', () => {}).then((value) => {
        service = value;
      }),
    ).rejects.toThrow(/TypeSafe/);
  } finally {
    await service?.close();
    store.close();
  }
});
