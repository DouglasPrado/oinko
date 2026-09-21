import { describe, it, expect, vi } from 'vitest';
import { JevDecider } from '../../../src/decision/jev-decider.js';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function createFetch(
  responses: { status: number; body: unknown }[],
): { fetch: (request: Request) => Promise<Response>; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  let call = 0;

  const fetch = async (request: Request): Promise<Response> => {
    captured.push({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body: JSON.parse(await request.text()) as Record<string, unknown>,
    });
    const next = responses[Math.min(call++, responses.length - 1)]!;
    return new Response(JSON.stringify(next.body), { status: next.status });
  };

  return { fetch, captured };
}

const NOUL_OK = {
  status: 200,
  body: { model: 'jev-1.13.0', answers: { durable: { type: 'noul', noul: 0.95 } } },
};

describe('JevDecider', () => {
  describe('request shape', () => {
    it('posts to the System One endpoint with bearer auth', async () => {
      const { fetch, captured } = createFetch([NOUL_OK]);
      const decider = new JevDecider({ apiKey: 'sk-test', fetch });

      await decider.decide('user said something', {
        durable: { kind: 'bool', instructions: 'Is it durable?' },
      });

      expect(captured[0]!.url).toBe('https://api.typesafe.ai/v1/systemone');
      expect(captured[0]!.method).toBe('POST');
      expect(captured[0]!.headers.authorization).toBe('Bearer sk-test');
      expect(captured[0]!.headers['content-type']).toContain('application/json');
    });

    it('sends state, model and the question map', async () => {
      const { fetch, captured } = createFetch([NOUL_OK]);
      const decider = new JevDecider({ apiKey: 'sk-test', fetch });

      await decider.decide('meu CNPJ e 123', {
        durable: {
          kind: 'bool',
          instructions: 'Durable fact?',
          criteria: { true: 'states a lasting fact', false: 'small talk' },
        },
      });

      expect(captured[0]!.body).toEqual({
        state: 'meu CNPJ e 123',
        model: 'jev-latest',
        questions: {
          durable: {
            type: 'noul',
            instructions: 'Durable fact?',
            criteria: { true: 'states a lasting fact', false: 'small talk' },
          },
        },
      });
    });

    it('maps choice and score questions to the wire format', async () => {
      const { fetch, captured } = createFetch([
        {
          status: 200,
          body: {
            model: 'jev-1.13.0',
            answers: {
              route: { type: 'choice', choice: 'billing', probabilities: {}, confidence: 0.8 },
              heat: { type: 'score', score: 1.05, legend: {}, probabilities: {}, confidence: 0.9 },
            },
          },
        },
      ]);
      const decider = new JevDecider({ apiKey: 'sk-test', fetch });

      await decider.decide('state', {
        route: { kind: 'choice', instructions: 'Which team?', criteria: { billing: 'money' } },
        heat: { kind: 'score', instructions: 'How hot?', criteria: ['cold', 'warm', 'hot'] },
      });

      const questions = captured[0]!.body.questions as Record<string, Record<string, unknown>>;
      expect(questions.route).toEqual({
        type: 'choice',
        instructions: 'Which team?',
        criteria: { billing: 'money' },
      });
      expect(questions.heat).toEqual({
        type: 'score',
        instructions: 'How hot?',
        criteria: ['cold', 'warm', 'hot'],
      });
    });

    it('allows overriding model and baseUrl', async () => {
      const { fetch, captured } = createFetch([NOUL_OK]);
      const decider = new JevDecider({
        apiKey: 'sk-test',
        fetch,
        model: 'jev-1.13.0',
        baseUrl: 'https://proxy.internal/v1',
      });

      await decider.decide('s', { durable: { kind: 'bool', instructions: 'x' } });

      expect(captured[0]!.url).toBe('https://proxy.internal/v1/systemone');
      expect(captured[0]!.body.model).toBe('jev-1.13.0');
    });
  });

  describe('answer mapping', () => {
    it('maps a high noul to true with its probability as confidence', async () => {
      const { fetch } = createFetch([NOUL_OK]);
      const decider = new JevDecider({ apiKey: 'sk-test', fetch });

      const answers = await decider.decide('s', {
        durable: { kind: 'bool', instructions: 'x' },
      });

      expect(answers.durable.value).toBe(true);
      expect(answers.durable.confidence).toBeCloseTo(0.95);
    });

    it('maps a low noul to false and mirrors the confidence', async () => {
      const { fetch } = createFetch([
        { status: 200, body: { answers: { durable: { type: 'noul', noul: 0.1 } } } },
      ]);
      const decider = new JevDecider({ apiKey: 'sk-test', fetch });

      const answers = await decider.decide('s', {
        durable: { kind: 'bool', instructions: 'x' },
      });

      expect(answers.durable.value).toBe(false);
      expect(answers.durable.confidence).toBeCloseTo(0.9);
    });

    it('maps choice and score answers', async () => {
      const { fetch } = createFetch([
        {
          status: 200,
          body: {
            answers: {
              route: { type: 'choice', choice: 'billing', confidence: 0.81 },
              heat: { type: 'score', score: 1.05, confidence: 0.92 },
            },
          },
        },
      ]);
      const decider = new JevDecider({ apiKey: 'sk-test', fetch });

      const answers = await decider.decide('s', {
        route: { kind: 'choice', instructions: 'x', criteria: { billing: 'b', sales: 's' } },
        heat: { kind: 'score', instructions: 'x', criteria: ['a', 'b'] },
      });

      expect(answers.route.value).toBe('billing');
      expect(answers.route.confidence).toBeCloseTo(0.81);
      expect(answers.heat.value).toBeCloseTo(1.05);
      expect(answers.heat.confidence).toBeCloseTo(0.92);
    });

    it('throws when the response omits a requested question', async () => {
      const { fetch } = createFetch([{ status: 200, body: { answers: {} } }]);
      const decider = new JevDecider({ apiKey: 'sk-test', fetch });

      await expect(
        decider.decide('s', { durable: { kind: 'bool', instructions: 'x' } }),
      ).rejects.toThrow(/durable/);
    });
  });

  describe('errors and retry', () => {
    it('throws a descriptive error on 401', async () => {
      const { fetch } = createFetch([{ status: 401, body: { error: 'invalid key' } }]);
      const decider = new JevDecider({ apiKey: 'bad', fetch, maxRetries: 0 });

      await expect(
        decider.decide('s', { durable: { kind: 'bool', instructions: 'x' } }),
      ).rejects.toThrow(/401/);
    });

    it('does not retry a 422', async () => {
      const { fetch, captured } = createFetch([{ status: 422, body: { error: 'bad request' } }]);
      const decider = new JevDecider({ apiKey: 'sk', fetch, maxRetries: 3, initialDelay: 1 });

      await expect(
        decider.decide('s', { durable: { kind: 'bool', instructions: 'x' } }),
      ).rejects.toThrow(/422/);
      expect(captured).toHaveLength(1);
    });

    it('retries a 429 and succeeds', async () => {
      const { fetch, captured } = createFetch([
        { status: 429, body: { error: 'slow down' } },
        NOUL_OK,
      ]);
      const decider = new JevDecider({ apiKey: 'sk', fetch, maxRetries: 2, initialDelay: 1 });

      const answers = await decider.decide('s', {
        durable: { kind: 'bool', instructions: 'x' },
      });

      expect(answers.durable.value).toBe(true);
      expect(captured).toHaveLength(2);
    });

    it('retries a 529 overload', async () => {
      const { fetch, captured } = createFetch([
        { status: 529, body: { error: 'overloaded' } },
        NOUL_OK,
      ]);
      const decider = new JevDecider({ apiKey: 'sk', fetch, maxRetries: 2, initialDelay: 1 });

      await decider.decide('s', { durable: { kind: 'bool', instructions: 'x' } });
      expect(captured).toHaveLength(2);
    });

    it('aborts when the caller signal fires', async () => {
      const controller = new AbortController();
      const fetch = vi.fn().mockImplementation(async (request: Request) => {
        controller.abort();
        if (request.signal.aborted) throw new Error('Aborted');
        return new Response('{}', { status: 200 });
      });
      const decider = new JevDecider({ apiKey: 'sk', fetch, maxRetries: 0 });

      await expect(
        decider.decide('s', { durable: { kind: 'bool', instructions: 'x' } }, controller.signal),
      ).rejects.toThrow();
    });
  });
});
