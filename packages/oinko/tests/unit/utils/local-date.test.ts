import { describe, it, expect } from 'vitest';
import { localDateInfo, isValidTimeZone, startOfLocalDay } from '../../../src/utils/local-date.js';

describe('localDateInfo', () => {
  // 23:30 in São Paulo is already the next day in UTC — the case that used to
  // tell a Brazilian user it was tomorrow every night after 21:00.
  const lateEvening = new Date('2026-09-24T02:30:00Z');

  it('reports the local date, not the UTC one', () => {
    expect(localDateInfo(lateEvening, 'America/Sao_Paulo')).toEqual({
      date: '2026-09-23',
      time: '23:30',
      weekday: 'Wednesday',
      timeZone: 'America/Sao_Paulo',
    });
  });

  it('agrees with UTC when asked for UTC', () => {
    expect(localDateInfo(lateEvening, 'UTC')).toMatchObject({
      date: '2026-09-24',
      time: '02:30',
      weekday: 'Thursday',
    });
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects anything else', () => {
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('startOfLocalDay', () => {
  it('is local midnight, as an instant', () => {
    // São Paulo is UTC-3 year-round since 2019.
    expect(new Date(startOfLocalDay('2026-09-23', 'America/Sao_Paulo')).toISOString()).toBe(
      '2026-09-23T03:00:00.000Z',
    );
    expect(new Date(startOfLocalDay('2026-09-23', 'UTC')).toISOString()).toBe(
      '2026-09-23T00:00:00.000Z',
    );
  });

  it('follows daylight saving time', () => {
    // New York: EDT (UTC-4) in July, EST (UTC-5) in January.
    expect(new Date(startOfLocalDay('2026-07-01', 'America/New_York')).toISOString()).toBe(
      '2026-07-01T04:00:00.000Z',
    );
    expect(new Date(startOfLocalDay('2026-01-15', 'America/New_York')).toISOString()).toBe(
      '2026-01-15T05:00:00.000Z',
    );
  });
});
