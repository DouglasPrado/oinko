export type TokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct';

interface Token {
  text: string;
  kind: TokenKind;
}

export interface JsonLine {
  depth: number;
  tokens: Token[];
  /** Quando a linha abre um bloco, o indice da linha que o fecha. */
  closesAt?: number;
}

function scalarToken(value: unknown): Token {
  if (typeof value === 'string') return { text: JSON.stringify(value), kind: 'string' };
  if (typeof value === 'number') return { text: String(value), kind: 'number' };
  if (typeof value === 'boolean') return { text: String(value), kind: 'boolean' };
  if (value === null) return { text: 'null', kind: 'null' };
  // undefined, funcao e symbol nao sobrevivem a JSON.parse, mas o tipo permite.
  return { text: typeof value, kind: 'null' };
}

/**
 * Serializa o valor em linhas, uma por linha do JSON formatado.
 *
 * Feito aqui, e nao com JSON.stringify mais um destacador de sintaxe, porque a
 * travessia ja conhece a profundidade e o tipo de cada valor — a informacao que
 * o destacador teria de redescobrir por expressao regular, e que e o que
 * permite desenhar as guias de indentacao e dobrar um bloco.
 */
export function toJsonLines(value: unknown): JsonLine[] {
  const lines: JsonLine[] = [];

  function push(depth: number, tokens: Token[]): number {
    lines.push({ depth, tokens });
    return lines.length - 1;
  }

  function walk(value: unknown, depth: number, prefix: Token[], suffix: string): void {
    const branch = typeof value === 'object' && value !== null;

    if (!branch) {
      push(depth, [...prefix, scalarToken(value), ...(suffix ? [punct(suffix)] : [])]);
      return;
    }

    const array = Array.isArray(value);
    const entries: [string | null, unknown][] = array
      ? (value as unknown[]).map((item) => [null, item])
      : Object.entries(value as Record<string, unknown>);

    if (entries.length === 0) {
      push(depth, [...prefix, punct(array ? '[]' : '{}'), ...(suffix ? [punct(suffix)] : [])]);
      return;
    }

    const opening = push(depth, [...prefix, punct(array ? '[' : '{')]);

    entries.forEach(([key, item], index) => {
      const last = index === entries.length - 1;
      const childPrefix: Token[] =
        key === null ? [] : [{ text: JSON.stringify(key), kind: 'key' }, punct(': ')];
      walk(item, depth + 1, childPrefix, last ? '' : ',');
    });

    const closing = push(depth, [punct(array ? ']' : '}'), ...(suffix ? [punct(suffix)] : [])]);
    const line = lines[opening];
    if (line) line.closesAt = closing;
  }

  function punct(text: string): Token {
    return { text, kind: 'punct' };
  }

  walk(value, 0, [], '');
  return lines;
}
