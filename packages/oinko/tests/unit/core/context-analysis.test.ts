import { describe, it, expect } from 'vitest';
import { analyzeContext } from '../../../src/core/context-analysis.js';
import type { LLMMessage } from '../../../src/llm/message-types.js';

describe('analyzeContext', () => {
  it('should count tokens by role', () => {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello there' },
      { role: 'assistant', content: 'Hi!' },
    ];

    const analysis = analyzeContext(messages);
    expect(analysis.totalTokens).toBeGreaterThan(0);
    expect(analysis.byRole.system).toBeGreaterThan(0);
    expect(analysis.byRole.user).toBeGreaterThan(0);
    expect(analysis.byRole.assistant).toBeGreaterThan(0);
  });

  it('should count tool result tokens', () => {
    const messages: LLMMessage[] = [
      { role: 'tool', content: 'result data', tool_call_id: 'tc-1' },
      { role: 'tool', content: 'more data', tool_call_id: 'tc-2' },
    ];

    const analysis = analyzeContext(messages);
    expect(analysis.byRole.tool).toBeGreaterThan(0);
    expect(analysis.toolResultCount).toBe(2);
    expect(analysis.toolResultChars).toBeGreaterThan(0);
  });

  it('should return message count', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ];

    const analysis = analyzeContext(messages);
    expect(analysis.messageCount).toBe(3);
  });

  it('should handle empty messages', () => {
    const analysis = analyzeContext([]);
    expect(analysis.totalTokens).toBe(0);
    expect(analysis.messageCount).toBe(0);
  });
});

/**
 * An inlined image is a data URL hundreds of thousands of characters long.
 * Serialized and counted as text it reads as a six-figure token bill, which is
 * not an approximation of the real price (85 tokens at low detail) but a
 * different number entirely — and every decision downstream inherits it.
 */
describe('analyzeContext with images', () => {
  it('prices an inlined image by the image, not by its data URL', () => {
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this' },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${'A'.repeat(400_000)}`, detail: 'low' },
          },
        ],
      },
    ];

    const analysis = analyzeContext(messages);

    expect(analysis.totalTokens).toBeLessThan(200);
    expect(analysis.byRole.user).toBe(analysis.totalTokens);
  });
});
