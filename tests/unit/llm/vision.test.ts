import { describe, it, expect } from 'vitest';
import { supportsVision } from '../../../src/llm/model-registry.js';

/**
 * Cada veredito aqui foi sondado contra o provedor com um PNG de verdade, nao
 * lido da doc: os que enxergam devolveram "Red" para um quadrado vermelho; os
 * que nao, devolveram 404 "No endpoints found that support image input".
 */
describe('supportsVision', () => {
  it('accepts the families probed with an actual image', () => {
    for (const model of [
      'gpt-4o',
      'gpt-4.1',
      'gpt-4-turbo',
      'gpt-5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.5',
      'gpt-5.6',
      'gpt-6-astra',
      'o1',
      'o3',
      'o4-mini',
      'google/gemini-2.5-flash',
    ]) {
      expect(supportsVision(model), model).toBe(true);
    }
  });

  it('refuses the families the provider answers "no endpoints support image input" for', () => {
    for (const model of [
      'openai/gpt-oss-120b',
      'deepseek/deepseek-chat',
      'deepseek/deepseek-r1',
      'mistralai/mistral-large',
    ]) {
      expect(supportsVision(model), model).toBe(false);
    }
  });

  /**
   * Vision is near-universal now, so an unregistered model is assumed to see.
   * The opposite default would silently blind every model the registry has yet
   * to learn about — and the registry ages on its own.
   */
  it('assumes an unknown model can see', () => {
    expect(supportsVision('some-model-nobody-registered')).toBe(true);
  });
});
