import { describe, it, expect, vi, afterEach } from 'vitest';
import { shouldExtractWithDecider } from '../../../src/memory/extraction-gate.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';
import type { Logger } from '../../../src/utils/logger.js';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

/** Decider stub that answers the durable-fact question with a fixed verdict. */
function createDecider(noul: boolean, confidence = 0.9): Decider {
  return {
    decide: vi.fn().mockResolvedValue({ durable: { value: noul, confidence } }),
  };
}

describe('shouldExtractWithDecider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('without a decider (current heuristic)', () => {
    it('extracts on explicit trigger', async () => {
      const result = await shouldExtractWithDecider('lembre que eu uso vim', 0, {
        samplingRate: 0,
        extractionInterval: 999,
      });
      expect(result).toBe(true);
    });

    it('extracts when the turn interval is reached', async () => {
      const result = await shouldExtractWithDecider('bom dia', 10, {
        samplingRate: 0,
        extractionInterval: 10,
      });
      expect(result).toBe(true);
    });

    it('does not extract when neither trigger nor interval nor sampling fires', async () => {
      const result = await shouldExtractWithDecider('bom dia', 1, {
        samplingRate: 0,
        extractionInterval: 10,
      });
      expect(result).toBe(false);
    });
  });

  describe('with a decider', () => {
    it('extracts when the decider says the turn holds a durable fact', async () => {
      const decider = createDecider(true, 0.9);
      const result = await shouldExtractWithDecider(
        'meu CNPJ e 12.345.678/0001-90',
        1,
        { samplingRate: 0, extractionInterval: 999 },
        decider,
      );
      expect(result).toBe(true);
    });

    it('replaces the random sampling — no extraction when the decider says no', async () => {
      // Sampling alone would always fire here (rate 1). The decider must win.
      const decider = createDecider(false);
      const result = await shouldExtractWithDecider(
        'ok, obrigado',
        1,
        { samplingRate: 1, extractionInterval: 999 },
        decider,
      );
      expect(result).toBe(false);
    });

    it('ignores a positive verdict below the confidence floor', async () => {
      const decider = createDecider(true, 0.4);
      const result = await shouldExtractWithDecider(
        'talvez eu use isso',
        1,
        { samplingRate: 0, extractionInterval: 999, minConfidence: 0.7 },
        decider,
      );
      expect(result).toBe(false);
    });

    it('honours a configured confidence floor', async () => {
      const decider = createDecider(true, 0.55);
      const result = await shouldExtractWithDecider(
        'talvez eu use isso',
        1,
        { samplingRate: 0, extractionInterval: 999, minConfidence: 0.5 },
        decider,
      );
      expect(result).toBe(true);
    });

    it('skips the decider entirely on an explicit trigger', async () => {
      const decider = createDecider(false);
      const result = await shouldExtractWithDecider(
        'lembre que eu prefiro dark mode',
        1,
        { samplingRate: 0, extractionInterval: 999 },
        decider,
      );
      expect(result).toBe(true);
      expect(decider.decide).not.toHaveBeenCalled();
    });

    it('asks a single bool question about the last message', async () => {
      const decider = createDecider(true);
      await shouldExtractWithDecider(
        'eu moro em Sao Paulo',
        1,
        { samplingRate: 0, extractionInterval: 999 },
        decider,
      );
      const [state, questions] = (decider.decide as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(state).toBe('eu moro em Sao Paulo');
      expect(Object.keys(questions)).toEqual(['durable']);
      expect(questions.durable.kind).toBe('bool');
    });
  });

  describe('degradation', () => {
    it('falls back to the heuristic when the decider throws', async () => {
      const decider = {
        decide: vi.fn().mockRejectedValue(new Error('network down')),
      } as unknown as Decider;
      const logger = createLogger();

      // Interval reached — the heuristic alone would extract.
      const result = await shouldExtractWithDecider(
        'bom dia',
        10,
        { samplingRate: 0, extractionInterval: 10 },
        decider,
        { logger },
      );

      expect(result).toBe(true);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('falls back to a negative heuristic when the decider throws', async () => {
      const decider = {
        decide: vi.fn().mockRejectedValue(new Error('timeout')),
      } as unknown as Decider;

      const result = await shouldExtractWithDecider(
        'bom dia',
        1,
        { samplingRate: 0, extractionInterval: 10 },
        decider,
      );
      expect(result).toBe(false);
    });
  });
});
