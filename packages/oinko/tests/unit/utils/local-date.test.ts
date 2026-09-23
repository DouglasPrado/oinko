import { describe, it, expect } from 'vitest';
import { localDateInfo, isValidTimeZone } from '../../../src/utils/local-date.js';

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
