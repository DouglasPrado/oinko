import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMClient } from '../../../src/llm/llm-client.js';
import { GenerationNotReadyError } from '../../../src/llm/errors.js';

let client: LLMClient;

beforeEach(() => {
  client = new LLMClient({
    apiKey: 'sk-test-key',
    model: 'test/model',
    baseUrl: 'https://openrouter.ai/api/v1',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function respond(status: number, body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

describe('LLMClient.getGeneration', () => {
  it('asks the right URL with the credential in the header', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { total_cost: 0.01 } }), { status: 200 }),
      );

    await client.getGeneration('gen-abc123');

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/generation?id=gen-abc123');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-key');
  });

  it('maps the fields that describe the real cost', async () => {
    respond(200, {
      data: {
        total_cost: 0.00042,
        upstream_inference_cost: 0.00039,
        cache_discount: 0.00001,
        native_tokens_cached: 128,
        native_tokens_reasoning: 9,
        provider_name: 'Anthropic',
        native_finish_reason: 'end_turn',
      },
    });

    const stats = await client.getGeneration('gen-abc');

    expect(stats.totalCostUsd).toBeCloseTo(0.00042, 9);
    expect(stats.upstreamCostUsd).toBeCloseTo(0.00039, 9);
    expect(stats.cachedTokens).toBe(128);
    expect(stats.providerName).toBe('Anthropic');
  });

  // 404 aqui nao quer dizer "nao existe": a geracao pode nao ter sido
  // contabilizada no instante em que o stream fechou.
  it('treats a not-found as not-ready, so the call stays in the queue', async () => {
    respond(404, { error: 'not found' });
    await expect(client.getGeneration('gen-abc')).rejects.toBeInstanceOf(GenerationNotReadyError);
  });

  it('treats a body without cost as not-ready too', async () => {
    respond(200, { data: { total_cost: null } });
    await expect(client.getGeneration('gen-abc')).rejects.toBeInstanceOf(GenerationNotReadyError);
  });

  // 401 e definitivo: insistir nao muda nada e so gasta requisicao.
  it('does not disguise an authentication failure as not-ready', async () => {
    respond(401, { error: 'unauthorized' });

    const error = await client.getGeneration('gen-abc').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GenerationNotReadyError);
  });
});
