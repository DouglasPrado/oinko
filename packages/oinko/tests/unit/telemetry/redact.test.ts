import { describe, it, expect } from 'vitest';
import { redactSecrets, REDACTED } from '../../../src/telemetry/redact.js';

describe('redactSecrets', () => {
  describe('by key name', () => {
    it('redacts values under sensitive keys regardless of casing or separators', () => {
      const out = redactSecrets({
        Authorization: 'Bearer abc123',
        api_key: 'sk-live-0123456789abcdef',
        'x-api-key': 'xyz',
        apiKey: 'another',
        password: 'hunter2',
        'set-cookie': 'session=1',
        client_secret: 'shh',
      });

      expect(out).not.toContain('hunter2');
      expect(out).not.toContain('session=1');
      expect(out).not.toContain('shh');
      expect(out).not.toContain('xyz');
      expect(out).not.toContain('another');
      expect(out).toContain(REDACTED);
    });

    // A substring match on "token" would wipe the usage counts, which are the
    // whole point of the telemetry. Keys must match exactly once normalised.
    it('leaves token count fields alone', () => {
      const out = redactSecrets({
        usage: { prompt_tokens: 194, completion_tokens: 2, total_tokens: 196 },
        maxTokens: 4096,
        reasoning_tokens: 7,
      });

      expect(out).toContain('194');
      expect(out).toContain('196');
      expect(out).toContain('4096');
      expect(out).not.toContain(REDACTED);
    });

    it('redacts an exact token key', () => {
      expect(redactSecrets({ token: 'abcdef123456' })).not.toContain('abcdef123456');
    });
  });

  describe('by pattern in free text', () => {
    it('redacts provider keys, bearer tokens, github tokens and JWTs', () => {
      const text = [
        'use sk-or-v1-0123456789abcdef0123456789abcdef as the key',
        'header: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-def_123',
        'and ghp_0123456789abcdefghij0123456789abcdef',
      ].join('\n');

      const out = redactSecrets(text);

      expect(out).not.toContain('sk-or-v1-0123456789abcdef');
      expect(out).not.toContain('ghp_0123456789abcdefghij');
      expect(out).not.toMatch(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
      expect(out).toContain('use ');
      expect(out).toContain(REDACTED);
    });

    it('scans strings nested in objects and arrays', () => {
      const out = redactSecrets({
        messages: [
          { role: 'user', content: 'my key is sk-live-0123456789abcdef0123' },
          { role: 'assistant', content: 'noted' },
        ],
      });

      expect(out).not.toContain('sk-live-0123456789abcdef0123');
      expect(out).toContain('noted');
    });
  });

  describe('literal secrets', () => {
    // The agent's own apiKey can reach a payload through a prompt or a header.
    it("scrubs the caller's own secrets wherever they appear", () => {
      const apiKey = 'sk-proj-THIS-IS-THE-AGENT-KEY-0123456789';
      const out = redactSecrets(
        { note: `the configured key is ${apiKey}`, nested: { echo: apiKey } },
        { secrets: [apiKey] },
      );

      expect(out).not.toContain(apiKey);
      expect(out).toContain('the configured key is');
    });

    it('ignores short secrets that would redact ordinary text', () => {
      const out = redactSecrets(
        { note: 'a short and ordinary sentence' },
        { secrets: ['a', 'and'] },
      );
      expect(out).toContain('a short and ordinary sentence');
    });
  });

  describe('robustness', () => {
    it('does not throw on circular references', () => {
      const cyclic: Record<string, unknown> = { name: 'root' };
      cyclic.self = cyclic;

      const out = redactSecrets(cyclic);

      expect(out).toContain('root');
      expect(out).toContain('[circular]');
    });

    it('does not throw on values JSON cannot serialise', () => {
      const out = redactSecrets({ big: BigInt(9_007_199_254_740_993n), fn: () => 1 });
      expect(typeof out).toBe('string');
    });

    it('returns a plain string unchanged rather than a JSON-quoted one', () => {
      // A system prompt is stored as-is; JSON-quoting it would corrupt display.
      expect(redactSecrets('You are a helpful assistant.')).toBe('You are a helpful assistant.');
    });
  });

  describe('truncation', () => {
    it('truncates to maxChars keeping head and tail', () => {
      const out = redactSecrets('A'.repeat(500) + 'TAILMARK', { maxChars: 100 });

      expect(out.length).toBeLessThan(200);
      expect(out).toContain('[truncated');
      expect(out).toContain('TAILMARK');
    });

    it('leaves content under the limit untouched', () => {
      expect(redactSecrets('short', { maxChars: 100 })).toBe('short');
    });
  });
});

describe('redactSecrets — personal identifiers (LGPD)', () => {
  it('masks a CPF, a CNPJ and a card number wherever they appear', () => {
    const out = redactSecrets({
      injections: [{ content: 'memória: CPF 529.982.247-25, empresa 11.222.333/0001-81' }],
      userInput: 'paga no 4111 1111 1111 1111',
    });
    expect(out).not.toContain('529.982.247-25');
    expect(out).not.toContain('11.222.333/0001-81');
    expect(out).not.toContain('4111 1111 1111 1111');
    expect(out).toContain(REDACTED);
  });

  it('leaves token counts and ordinary numbers alone', () => {
    const out = redactSecrets({ total_tokens: 52998224725, note: 'pedido 12345' });
    expect(out).toContain('52998224725');
    expect(out).toContain('pedido 12345');
  });
});
