import { describe, expect, it } from 'vitest';
import { RefTable } from '../src/browser/snapshot.js';
import { BrowserError } from '../src/browser/errors.js';

function code(action: () => unknown) {
  try {
    action();
  } catch (error) {
    return error instanceof BrowserError ? error.code : 'other';
  }
  return 'none';
}

describe('RefTable (snapshot refs)', () => {
  const page = { id: 'page-1' };
  const other = { id: 'page-2' };

  it('requires a snapshot and resolves refs of the current one only', () => {
    const table = new RefTable<string>();
    expect(code(() => table.lookup({ ref: 'e1', page, navigation: 0 }))).toBe('snapshot_required');
    const first = table.bind({
      page,
      navigation: 0,
      handles: ['a', 'b'],
      fingerprints: ['fa', 'fb'],
    });
    expect(first).toBe('s1');
    expect(table.lookup({ ref: 'e2', page, navigation: 0 })).toEqual({
      handle: 'b',
      fingerprint: 'fb',
    });
    expect(table.lookup({ ref: 'e1', snapshotId: 's1', page, navigation: 0 }).handle).toBe('a');
    expect(code(() => table.lookup({ ref: 'e3', page, navigation: 0 }))).toBe('invalid_ref');
  });

  it('treats refs of an older snapshot, a navigation or another page as stale', () => {
    const table = new RefTable<string>();
    table.bind({ page, navigation: 0, handles: ['a'], fingerprints: ['fa'] });
    const second = table.bind({ page, navigation: 0, handles: ['x'], fingerprints: ['fx'] });
    expect(second).toBe('s2');
    expect(code(() => table.lookup({ ref: 'e1', snapshotId: 's1', page, navigation: 0 }))).toBe(
      'stale_element',
    );
    expect(code(() => table.lookup({ ref: 'e1', page, navigation: 1 }))).toBe('stale_element');
    expect(code(() => table.lookup({ ref: 'e1', page: other, navigation: 0 }))).toBe(
      'stale_element',
    );
  });

  it('checks the live element: detached or changed role/name means stale, never old coordinates', () => {
    const table = new RefTable<string>();
    table.bind({ page, navigation: 0, handles: ['a'], fingerprints: ['button|Enviar'] });
    const target = table.lookup({ ref: 'e1', page, navigation: 0 });
    expect(
      code(() => RefTable.verify(target, { connected: false, fingerprint: 'button|Enviar' })),
    ).toBe('stale_element');
    expect(
      code(() => RefTable.verify(target, { connected: true, fingerprint: 'button|Excluir' })),
    ).toBe('stale_element');
    expect(
      code(() => RefTable.verify(target, { connected: true, fingerprint: 'button|Enviar' })),
    ).toBe('none');
  });

  it('releases handles of replaced snapshots', () => {
    const released: string[][] = [];
    const table = new RefTable<string>((handles) => released.push(handles));
    table.bind({ page, navigation: 0, handles: ['a', 'b'], fingerprints: ['fa', 'fb'] });
    table.bind({ page, navigation: 0, handles: ['c'], fingerprints: ['fc'] });
    table.clear();
    expect(released).toEqual([['a', 'b'], ['c']]);
  });
});
