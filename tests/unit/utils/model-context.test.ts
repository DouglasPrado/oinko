import { describe, it, expect } from 'vitest';
import { getModelContextWindow } from '../../../src/utils/model-context.js';

describe('getModelContextWindow', () => {
  it('should return known context window for Claude models', () => {
    expect(getModelContextWindow('anthropic/claude-sonnet-4')).toBe(200_000);
    expect(getModelContextWindow('anthropic/claude-opus-4.5')).toBe(200_000);
    expect(getModelContextWindow('anthropic/claude-haiku-4.5')).toBe(200_000);
  });

  it('should know the 1M context line', () => {
    expect(getModelContextWindow('anthropic/claude-sonnet-5')).toBe(1_000_000);
    expect(getModelContextWindow('anthropic/claude-opus-5')).toBe(1_000_000);
    expect(getModelContextWindow('anthropic/claude-fable-5.1')).toBe(1_000_000);
    expect(getModelContextWindow('anthropic/claude-sonnet-4.6')).toBe(1_000_000);
  });

  /**
   * Matching is substring-based in array order, so 'claude-opus-4' also
   * matches 'claude-opus-4.8'. The 1M entries must stay above the 200k ones or
   * these models silently lose four fifths of their window.
   */
  it('should prefer the more specific pattern over the shorter one', () => {
    expect(getModelContextWindow('anthropic/claude-opus-4.8')).toBe(1_000_000);
    expect(getModelContextWindow('anthropic/claude-opus-4.7')).toBe(1_000_000);
    expect(getModelContextWindow('anthropic/claude-sonnet-4.5')).toBe(1_000_000);
    // ...while the plain 4 line keeps its 200k.
    expect(getModelContextWindow('anthropic/claude-opus-4.1')).toBe(200_000);
  });

  it('should return known context window for GPT models', () => {
    expect(getModelContextWindow('openai/gpt-4o')).toBe(128_000);
    expect(getModelContextWindow('openai/gpt-4-turbo')).toBe(128_000);
  });

  it('should know the current OpenAI line', () => {
    expect(getModelContextWindow('openai/gpt-6-astra')).toBe(1_050_000);
    expect(getModelContextWindow('openai/gpt-5.6-luna')).toBe(1_050_000);
    expect(getModelContextWindow('openai/gpt-5.5-pro')).toBe(1_050_000);
    expect(getModelContextWindow('openai/gpt-4.1-mini')).toBe(1_047_576);
    expect(getModelContextWindow('openai/gpt-5-nano')).toBe(400_000);
    expect(getModelContextWindow('openai/gpt-5.2-codex')).toBe(400_000);
  });

  /**
   * 'gpt-5' is a prefix of 'gpt-5.6', and 'gpt-5.4' of 'gpt-5.4-image-2'.
   * Reordering these entries silently costs models most of their window.
   */
  it('should prefer the more specific GPT pattern', () => {
    expect(getModelContextWindow('openai/gpt-5.4')).toBe(1_050_000);
    expect(getModelContextWindow('openai/gpt-5.4-image-2')).toBe(272_000);
    expect(getModelContextWindow('openai/gpt-5.2-chat')).toBe(128_000);
    expect(getModelContextWindow('openai/gpt-5.2')).toBe(400_000);
  });

  it('should return default for unknown models', () => {
    expect(getModelContextWindow('unknown/model-xyz')).toBe(128_000);
  });

  it('should match partial model names', () => {
    expect(getModelContextWindow('anthropic/claude-sonnet-4:beta')).toBe(200_000);
    expect(getModelContextWindow('anthropic/claude-sonnet-5:batch')).toBe(1_000_000);
  });

  it('should accept override', () => {
    expect(getModelContextWindow('unknown/model', 64_000)).toBe(64_000);
  });
});
