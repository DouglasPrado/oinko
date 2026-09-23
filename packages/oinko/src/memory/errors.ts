import type { SensitiveKind } from '../utils/sensitive-data.js';
import { describeSensitiveKinds } from '../utils/sensitive-data.js';

/**
 * Thrown when content bound for memory holds something memory never stores —
 * a CPF, a card number, a credential. Carries the kinds, never the values.
 */
export class SensitiveDataError extends Error {
  readonly kinds: readonly SensitiveKind[];

  constructor(kinds: readonly SensitiveKind[]) {
    const unique = [...new Set(kinds)];
    super(
      `Memory never stores ${describeSensitiveKinds(unique.map((kind) => ({ kind, start: 0, end: 0 })))}`,
    );
    this.name = 'SensitiveDataError';
    this.kinds = unique;
  }
}
