import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BotStore } from '../src/store.js';
import { modelPolicyProblems } from '../src/programming/models.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const base = { id: 'alpha', name: 'Alpha', model: 'openai/gpt-4o-mini', systemPrompt: 'x' };

describe('M07-S04 run model policy is validated before activation', () => {
  it('accepts different models per bot and rejects what cannot work', () => {
    expect(modelPolicyProblems({ ...base, programmingPolicy: { enabled: true, models: { main: 'anthropic/claude-sonnet-5', fallbackAfterMs: 15_000 }, context: { selectTools: false, maxTools: 16 } } as never })).toEqual([]);
    // Prefixed OpenRouter ids against the OpenAI API are refused with a verifiable message.
    expect(modelPolicyProblems({ ...base, baseUrl: 'https://api.openai.com/v1', programmingPolicy: { enabled: true, models: { fallbackAfterMs: 15_000 }, context: { selectTools: false, maxTools: 16 } } as never })[0]).toMatch(/prefix/);
    // Fast model and tool selection are only real with Jev routing.
    const withoutJev = modelPolicyProblems({ ...base, programmingPolicy: { enabled: true, models: { fast: 'openai/gpt-4o-mini-fast', fallbackAfterMs: 15_000 }, context: { selectTools: true, maxTools: 16 } } as never });
    expect(withoutJev).toEqual([expect.stringMatching(/modelo rápido/), expect.stringMatching(/seleção progressiva/)]);
    expect(modelPolicyProblems({ ...base, programmingPolicy: { enabled: false } as never })).toEqual([]);
  });

  it('refuses to save an invalid run policy, keeping the previous revision', () => {
    const root = mkdtempSync(join(tmpdir(), 'oinko-models-'));
    roots.push(root);
    const store = new BotStore(root);
    const saved = store.save({ ...base, programmingPolicy: { enabled: true } }, { apiKey: 'sk-test-0123456789' }, 0);
    expect(() => store.save({ ...base, programmingPolicy: { enabled: true, models: { fast: 'openai/gpt-4o-mini' } } }, {}, saved.revision)).toThrow(/diferente do principal|modelo rápido/);
    expect(() => store.save({ ...base, programmingPolicy: { enabled: true, models: { fast: 'openai/gpt-x-fast' } } }, {}, saved.revision)).toThrow(/Jev/);
    expect(store.get('alpha').revision).toBe(saved.revision);
    store.close();
  });
});
