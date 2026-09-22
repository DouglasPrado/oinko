import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateContentTokens } from '../../../src/utils/token-counter.js';
import type { ContentPart } from '../../../src/contracts/entities/content-part.js';

describe('TokenCounter', () => {
  it('should estimate tokens for latin text (~4 chars per token)', () => {
    const text = 'Hello, this is a test message for token counting.';
    const tokens = estimateTokens(text);
    // ~50 chars / 4 = ~12 tokens
    expect(tokens).toBeGreaterThan(8);
    expect(tokens).toBeLessThan(20);
  });

  it('should estimate tokens for CJK text (~1.5 chars per token)', () => {
    const text = '这是一个测试消息用于令牌计数';
    const tokens = estimateTokens(text);
    // 14 CJK chars / 1.5 = ~9 tokens
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(15);
  });

  it('should handle mixed latin and CJK text', () => {
    const text = 'Hello 你好 World 世界';
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(3);
    expect(tokens).toBeLessThan(15);
  });

  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should handle whitespace-only strings', () => {
    expect(estimateTokens('   ')).toBeGreaterThanOrEqual(0);
  });

  it('should estimate tokens for an array of messages', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there!' },
    ];
    const tokens = estimateTokens(messages.map((m) => m.content).join('\n'));
    expect(tokens).toBeGreaterThan(2);
  });
});

/**
 * An image costs a flat price the provider publishes, and nothing like the
 * length of its URL. Counting a data URL as text was the bug: a 500KB PNG
 * inlined as base64 estimated at ~170k tokens, so the message never fit the
 * budget and was dropped before it could be sent.
 */
describe('estimateContentTokens', () => {
  const dataUrl = (bytes: number) => `data:image/png;base64,${'A'.repeat(bytes)}`;

  it('matches estimateTokens for a plain string', () => {
    expect(estimateContentTokens('hello world')).toBe(estimateTokens('hello world'));
  });

  it('counts text parts as text', () => {
    const parts: ContentPart[] = [{ type: 'text', text: 'hello world' }];
    expect(estimateContentTokens(parts)).toBe(estimateTokens('hello world'));
  });

  it('prices a low-detail image at the published flat rate', () => {
    const parts: ContentPart[] = [
      { type: 'image_url', image_url: { url: 'https://x.test/a.png', detail: 'low' } },
    ];
    expect(estimateContentTokens(parts)).toBe(85);
  });

  it('prices high and auto above low, since they tile the image', () => {
    const high: ContentPart[] = [
      { type: 'image_url', image_url: { url: 'https://x.test/a.png', detail: 'high' } },
    ];
    const auto: ContentPart[] = [{ type: 'image_url', image_url: { url: 'https://x.test/a.png' } }];

    expect(estimateContentTokens(high)).toBeGreaterThan(85);
    expect(estimateContentTokens(auto)).toBe(estimateContentTokens(high));
  });

  it('does not price an image by the length of its data URL', () => {
    const small: ContentPart[] = [
      { type: 'image_url', image_url: { url: dataUrl(100), detail: 'low' } },
    ];
    const huge: ContentPart[] = [
      { type: 'image_url', image_url: { url: dataUrl(500_000), detail: 'low' } },
    ];

    expect(estimateContentTokens(huge)).toBe(estimateContentTokens(small));
    expect(estimateContentTokens(huge)).toBeLessThan(200);
  });

  it('adds up mixed parts', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'hello world' },
      { type: 'image_url', image_url: { url: 'https://x.test/a.png', detail: 'low' } },
    ];
    expect(estimateContentTokens(parts)).toBe(estimateTokens('hello world') + 85);
  });
});
