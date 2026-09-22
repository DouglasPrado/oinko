import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TelemetryDatabase } from '../../../src/telemetry/telemetry-database.js';
import { PayloadStore } from '../../../src/telemetry/payload-store.js';

let database: TelemetryDatabase;
let store: PayloadStore;

beforeEach(() => {
  database = new TelemetryDatabase(':memory:');
  database.initialize();
  store = new PayloadStore(database.db);
});

afterEach(() => {
  database.close();
});

function rowCount(): number {
  const row = database.db.prepare('SELECT COUNT(*) AS n FROM payloads').get() as
    { n: number } | undefined;
  return row?.n ?? 0;
}

describe('PayloadStore', () => {
  it('stores content and reads it back', () => {
    const ref = store.put('You are a helpful assistant.');

    expect(store.get(ref.id)).toBe('You are a helpful assistant.');
    expect(ref.sizeBytes).toBe(28);
  });

  // The system prompt is byte-identical across every call of a run. Without
  // dedup the same 184 KB would be written once per LLM call.
  it('writes identical content once and returns the same id', () => {
    const first = store.put('same content');
    const second = store.put('same content');

    expect(second.id).toBe(first.id);
    expect(rowCount()).toBe(1);
  });

  it('gives different content different ids', () => {
    expect(store.put('a').id).not.toBe(store.put('b').id);
    expect(rowCount()).toBe(2);
  });

  it('measures size in bytes, not characters', () => {
    // "é" is two bytes in UTF-8; reporting 1 would understate the row.
    expect(store.put('é').sizeBytes).toBe(2);
  });

  it('keeps a bounded preview so listings never read the body', () => {
    const ref = store.put('x'.repeat(5_000), { previewChars: 100 });

    expect(ref.preview).toHaveLength(100);
    expect(ref.sizeBytes).toBe(5_000);
    expect(store.get(ref.id)).toHaveLength(5_000);
  });

  it('returns content shorter than the preview budget whole', () => {
    expect(store.put('short').preview).toBe('short');
  });

  // Purge deletes payloads by age. A prompt reused for months must not expire
  // out from under the executions that still point at it.
  it('renews the age of content that is stored again', () => {
    const ref = store.put('reused prompt', { now: 1_000 });
    store.put('reused prompt', { now: 90_000 });

    const row = database.db.prepare('SELECT created_at FROM payloads WHERE id = ?').get(ref.id) as
      { created_at: number } | undefined;

    expect(row?.created_at).toBe(90_000);
    expect(rowCount()).toBe(1);
  });

  it('marks whether the content went through redaction', () => {
    const redacted = store.put('clean', { redacted: true });
    const raw = store.put('untouched', { redacted: false });

    const flagOf = (id: string): number | undefined =>
      (
        database.db.prepare('SELECT redacted FROM payloads WHERE id = ?').get(id) as
          { redacted: number } | undefined
      )?.redacted;

    expect(flagOf(redacted.id)).toBe(1);
    expect(flagOf(raw.id)).toBe(0);
  });

  it('handles empty content', () => {
    const ref = store.put('');
    expect(ref.sizeBytes).toBe(0);
    expect(store.get(ref.id)).toBe('');
  });

  it('returns undefined for an unknown id', () => {
    expect(store.get('nope')).toBeUndefined();
  });
});
