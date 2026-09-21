import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getModelContextWindow,
  resetContextWindowWarnings,
} from '../../../src/utils/model-context.js';
import type { Logger } from '../../../src/utils/logger.js';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

describe('unregistered models are not silent', () => {
  beforeEach(() => {
    resetContextWindowWarnings();
  });

  it('warns once, naming the model and what was assumed', () => {
    const logger = createLogger();

    getModelContextWindow('acme/brand-new-model', undefined, logger);

    expect(logger.warn).toHaveBeenCalledOnce();
    const [message] = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(message).toContain('acme/brand-new-model');
    expect(message).toContain('128000');
    expect(message).toContain('model-registry');
  });

  it('does not repeat the warning for the same model', () => {
    const logger = createLogger();

    getModelContextWindow('acme/brand-new-model', undefined, logger);
    getModelContextWindow('acme/brand-new-model', undefined, logger);
    getModelContextWindow('acme/brand-new-model', undefined, logger);

    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('warns separately for a different unknown model', () => {
    const logger = createLogger();

    getModelContextWindow('acme/one', undefined, logger);
    getModelContextWindow('acme/two', undefined, logger);

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('stays quiet for a registered model', () => {
    const logger = createLogger();

    getModelContextWindow('anthropic/claude-sonnet-5', undefined, logger);

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('stays quiet when the caller gave an explicit window', () => {
    const logger = createLogger();

    expect(getModelContextWindow('acme/unknown', 512_000, logger)).toBe(512_000);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('still works without a logger', () => {
    expect(getModelContextWindow('acme/unknown')).toBe(128_000);
  });
});
