/**
 * The date as the user lives it.
 *
 * `toISOString()` answers in UTC: from 21:00 on in Brasília it is already
 * tomorrow, and an agent told the wrong day gets "today", "tomorrow" and
 * every date it computes wrong.
 */
export interface LocalDateInfo {
  /** YYYY-MM-DD in `timeZone`. */
  date: string;
  /** HH:mm, 24h, in `timeZone`. */
  time: string;
  /** English weekday name. */
  weekday: string;
  timeZone: string;
}

export function localDateInfo(now: Date, timeZone: string): LocalDateInfo {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'long',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    weekday: get('weekday'),
    timeZone,
  };
}

/** The host's own zone — what `timezone` defaults to when not configured. */
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The instant a calendar day (YYYY-MM-DD) begins in `timeZone`, in epoch ms.
 *
 * Takes the day's UTC midnight as a first guess, measures the zone's offset
 * there, and corrects by it — once more if the correction crossed a DST shift.
 */
export function startOfLocalDay(date: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(y, m - 1, d);
  let instant = utcMidnight - offsetAt(utcMidnight, timeZone);
  const corrected = utcMidnight - offsetAt(instant, timeZone);
  if (corrected !== instant) instant = corrected;
  return instant;
}

/** How far `timeZone` is ahead of UTC at `instant`, in ms. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - (instant - (instant % 1000));
}
