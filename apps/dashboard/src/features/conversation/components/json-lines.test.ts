import { describe, it, expect } from 'vitest';
import { toJsonLines } from './json-lines';

function render(value: unknown): string[] {
  return toJsonLines(value).map(
    (line) => '  '.repeat(line.depth) + line.tokens.map((token) => token.text).join(''),
  );
}

describe('toJsonLines', () => {
  it('lays a document out the way an editor shows it', () => {
    expect(render({ name: 'Apple', calories: 52 })).toEqual([
      '{',
      '  "name": "Apple",',
      '  "calories": 52',
      '}',
    ]);
  });

  it('omits the comma on the last entry, like valid JSON', () => {
    const lines = render({ a: 1, b: 2 });
    expect(lines[1]).toContain(',');
    expect(lines[2]).not.toContain(',');
  });

  it('nests arrays and objects with the right depth', () => {
    const lines = toJsonLines({ fruits: [{ name: 'Apple' }] });

    // { → fruits: [ → { → name → } → ] → }
    expect(lines.map((line) => line.depth)).toEqual([0, 1, 2, 3, 2, 1, 0]);
  });

  it('points each opening line at the line that closes it', () => {
    const lines = toJsonLines({ a: { b: 1 }, c: 2 });

    // Sem isso o leitor nao sabe o que esconder ao dobrar um bloco.
    expect(lines[0]?.closesAt).toBe(lines.length - 1);
    expect(lines[1]?.closesAt).toBe(3);
    expect(lines[2]?.closesAt).toBeUndefined();
  });

  it('keeps an empty container on one line', () => {
    expect(render({ items: [], meta: {} })).toEqual(['{', '  "items": [],', '  "meta": {}', '}']);
  });

  it('marks each token with what it is, so the reader can colour it', () => {
    const [, entry] = toJsonLines({ flag: true });
    expect(entry?.tokens.map((token) => token.kind)).toEqual(['key', 'punct', 'boolean']);
  });

  it('renders scalars at the root', () => {
    expect(render('solto')).toEqual(['"solto"']);
    expect(render(null)).toEqual(['null']);
  });

  it('escapes what JSON escapes', () => {
    expect(render({ text: 'linha\nquebrada' })[1]).toContain('\\n');
  });
});
