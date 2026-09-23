import { describe, it, expect } from 'vitest';
import { formatUsd, UNKNOWN } from './format-usd';
import { formatDuration, formatOffset } from './format-duration';
import { formatBytes } from './format-bytes';
import { formatTokens } from './format-tokens';

describe('formatUsd', () => {
  it('keeps the digits that matter for a fraction of a cent', () => {
    // Two decimals would render every call as US$ 0,00.
    expect(formatUsd(0.000042)).toContain('0,000042');
  });

  it('keeps four decimals in the range where conversations are compared', () => {
    // Two decimals here would render 0,0156 and 0,0203 both as "0,02".
    expect(formatUsd(0.0156)).toContain('0,0156');
  });

  it('uses two decimals once the amount is readable', () => {
    expect(formatUsd(12.5)).toContain('12,50');
  });

  it('drops trailing zeros that say nothing', () => {
    expect(formatUsd(0.0048)).toContain('0,0048');
    expect(formatUsd(0.0048)).not.toContain('0,004800');
  });

  it('shows unknown rather than zero when there is no cost', () => {
    // "Cost unknown" and "cost nothing" must never look the same.
    expect(formatUsd(null)).toBe(UNKNOWN);
    expect(formatUsd(undefined)).toBe(UNKNOWN);
    expect(formatUsd(0)).not.toBe(UNKNOWN);
  });
});

describe('formatDuration', () => {
  it('reads milliseconds below a second', () => {
    expect(formatDuration(748)).toBe('748 ms');
  });

  it('reads seconds, then minutes', () => {
    expect(formatDuration(1_240)).toBe('1,2 s');
    expect(formatDuration(124_000)).toBe('2 min 4 s');
  });

  it('shows unknown for a missing duration', () => {
    expect(formatDuration(null)).toBe(UNKNOWN);
  });
});

describe('formatOffset', () => {
  it('reads as a position on the tape', () => {
    expect(formatOffset(0)).toBe('+0ms');
    expect(formatOffset(2_100)).toBe('+2,1s');
  });
});

describe('formatBytes', () => {
  it('scales the unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(184_320)).toBe('180 KB');
    expect(formatBytes(null)).toBe(UNKNOWN);
  });
});

describe('formatTokens', () => {
  it('abbreviates thousands', () => {
    expect(formatTokens(196)).toBe('196');
    expect(formatTokens(8_200)).toBe('8,2k');
    expect(formatTokens(null)).toBe(UNKNOWN);
  });
});
