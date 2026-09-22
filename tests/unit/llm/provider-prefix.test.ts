import { describe, it, expect } from 'vitest';
import { checkModelSuitsEndpoint } from '../../../src/llm/model-registry.js';

describe('checkModelSuitsEndpoint', () => {
  it('rejects an OpenRouter-style id sent to the OpenAI API', () => {
    const problem = checkModelSuitsEndpoint('openai/gpt-4o-mini', 'https://api.openai.com/v1');
    expect(problem).toContain('openai/gpt-4o-mini');
    expect(problem).toContain('gpt-4o-mini');
  });

  it('names the provider prefix whatever it is', () => {
    expect(
      checkModelSuitsEndpoint('anthropic/claude-sonnet-5', 'https://api.openai.com/v1'),
    ).toMatch(/anthropic\//);
  });

  it('accepts a bare id on the OpenAI API', () => {
    expect(checkModelSuitsEndpoint('gpt-5.5', 'https://api.openai.com/v1')).toBeUndefined();
    expect(checkModelSuitsEndpoint('gpt-5.4-mini', 'https://api.openai.com/v1')).toBeUndefined();
  });

  it('accepts a prefixed id on OpenRouter, where it is the convention', () => {
    expect(
      checkModelSuitsEndpoint('openai/gpt-4o-mini', 'https://openrouter.ai/api/v1'),
    ).toBeUndefined();
    expect(
      checkModelSuitsEndpoint('anthropic/claude-sonnet-5', 'https://openrouter.ai/api/v1'),
    ).toBeUndefined();
  });

  it('says nothing about gateways it does not know', () => {
    expect(
      checkModelSuitsEndpoint('openai/gpt-4o-mini', 'https://my-gateway.internal/v1'),
    ).toBeUndefined();
    expect(checkModelSuitsEndpoint('whatever', 'https://litellm.local/v1')).toBeUndefined();
  });

  it('ignores a fine-tune id, which legitimately carries colons and slashes', () => {
    expect(
      checkModelSuitsEndpoint('ft:gpt-4o-mini:acme::abc123', 'https://api.openai.com/v1'),
    ).toBeUndefined();
  });
});
