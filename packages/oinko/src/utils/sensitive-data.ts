/**
 * Personal identifiers and credentials that must never be persisted.
 *
 * Deterministic on purpose: this is the floor under what an LLM decides to
 * save, so it cannot depend on one. It only claims what a pattern can prove —
 * check digits for CPF and CNPJ, Luhn plus a plausible issuer and length for a
 * card — because a false positive refuses an ordinary memory, and a phone
 * number or an order id is not a card.
 */

export type SensitiveKind = 'cpf' | 'cnpj' | 'card' | 'credential';

export interface SensitiveFinding {
  kind: SensitiveKind;
  start: number;
  end: number;
}

/**
 * Shapes that identify a credential inside free text. Bearer comes first so it
 * swallows the whole header value rather than leaving the scheme behind.
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g,
];

/** A password stated in the open: "senha: x", "password=x". */
const STATED_PASSWORD = /\b(?:senha|password|passwd|pwd)\s*[:=]\s*\S+/gi;

const CPF = /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g;
const CNPJ = /(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g;
/** 14 to 19 digits, optionally grouped by spaces or dashes. */
const CARD = /(?<!\d)(?:\d[ -]?){13,18}\d(?!\d)/g;

const digitsOf = (text: string): number[] => [...text.replace(/\D/g, '')].map(Number);

function isCpf(text: string): boolean {
  const d = digitsOf(text);
  if (d.length !== 11 || d.every((n) => n === d[0])) return false;
  const check = (len: number): number => {
    const sum = d.slice(0, len).reduce((acc, n, i) => acc + n * (len + 1 - i), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(9) === d[9] && check(10) === d[10];
}

function isCnpj(text: string): boolean {
  const d = digitsOf(text);
  if (d.length !== 14 || d.every((n) => n === d[0])) return false;
  const check = (len: number): number => {
    const weights =
      len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = d.slice(0, len).reduce((acc, n, i) => acc + n * weights[i]!, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === d[12] && check(13) === d[13];
}

function isCard(text: string): boolean {
  const d = digitsOf(text);
  // Issuers start with 2-6 (Mastercard, Amex, Diners, Visa, Elo, Hipercard...).
  if (d.length < 14 || d.length > 19 || d[0]! < 2 || d[0]! > 6) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = d[d.length - 1 - i]!;
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

function collect(
  text: string,
  pattern: RegExp,
  kind: SensitiveKind,
  valid: (match: string) => boolean = () => true,
): SensitiveFinding[] {
  const found: SensitiveFinding[] = [];
  for (const match of text.matchAll(pattern)) {
    if (valid(match[0]))
      found.push({ kind, start: match.index, end: match.index + match[0].length });
  }
  return found;
}

/** Every never-store span in `text`, in order, without overlaps. */
export function findNeverStore(text: string): SensitiveFinding[] {
  const all = [
    ...collect(text, CNPJ, 'cnpj', isCnpj),
    ...collect(text, CPF, 'cpf', isCpf),
    ...collect(text, CARD, 'card', isCard),
    ...SECRET_PATTERNS.flatMap((p) => collect(text, p, 'credential')),
    ...collect(text, STATED_PASSWORD, 'credential'),
  ].sort((a, b) => a.start - b.start || b.end - a.end);

  // The first (longest) claim on a span wins: a CNPJ is not also a card.
  const kept: SensitiveFinding[] = [];
  for (const finding of all) {
    const last = kept[kept.length - 1];
    if (!last || finding.start >= last.end) kept.push(finding);
  }
  return kept;
}

/** `text` with every never-store span replaced by `marker`. */
export function maskPersonalIdentifiers(text: string, marker: string): string {
  const findings = findNeverStore(text);
  let out = '';
  let cursor = 0;
  for (const { start, end } of findings) {
    out += text.slice(cursor, start) + marker;
    cursor = end;
  }
  return out + text.slice(cursor);
}

const LABELS: Record<SensitiveKind, string> = {
  cpf: 'a CPF number',
  cnpj: 'a CNPJ number',
  card: 'a payment card number',
  credential: 'a credential (password, token or key)',
};

/** "a CPF number and a payment card number" — the kinds found, never the values. */
export function describeSensitiveKinds(findings: readonly SensitiveFinding[]): string {
  const unique = [...new Set(findings.map((f) => f.kind))].map((kind) => LABELS[kind]);
  return unique.length <= 1
    ? (unique[0] ?? '')
    : `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}
