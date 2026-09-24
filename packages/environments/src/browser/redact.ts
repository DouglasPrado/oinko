/**
 * Redaction for everything the browser extension returns: console text,
 * network URLs, page text, titles and errors. Credential values are removed
 * by value (in raw and URL-encoded forms); headers and tokens by pattern.
 */
const SENSITIVE_NAME =
  /pass(word|wd)?|pwd|secret|token|otp|one[-_]?time|cvv|cvc|card[-_]?number|ssn|\bpin\b|api[-_]?key|apikey|auth|credential|session[-_]?id|\bsid\b|signature|\bsig\b|\bcode\b/i;
const SENSITIVE_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
]);
/** Credential values shorter than this are refused at save time (see vault). */
export const MIN_SECRET_LENGTH = 4;
const MARKER = '[redacted]';

const PATTERNS: [RegExp, string][] = [
  [/\b((?:proxy-)?authorization)(\s*[:=]\s*)[^\n\r,;]+/gi, `$1$2${MARKER}`],
  [/\b(set-cookie|cookie)(\s*[:=]\s*)[^\n\r]+/gi, `$1$2${MARKER}`],
  [/\b(Bearer|Basic|Digest)\s+[A-Za-z0-9._~+/=-]{6,}/g, `$1 ${MARKER}`],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, MARKER],
  [
    /\b([A-Za-z0-9_-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|session[_-]?id|credential)[A-Za-z0-9_-]*)(["']?\s*[:=]\s*["']?)([^\s"'&,;}]+)/gi,
    `$1$2${MARKER}`,
  ],
];

function bound(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…[truncado ${text.length - max}]` : text;
}

export function isSensitiveField(field: {
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
}): boolean {
  if (field.type?.toLowerCase() === 'password') return true;
  const autocomplete = field.autocomplete?.toLowerCase().trim().split(/\s+/) ?? [];
  if (autocomplete.some((token) => SENSITIVE_AUTOCOMPLETE.has(token))) return true;
  return [field.name, field.id].some((value) => !!value && SENSITIVE_NAME.test(value));
}

export class Redactor {
  private readonly secrets: string[];
  constructor(secrets: Iterable<string> = []) {
    const forms = new Set<string>();
    for (const secret of secrets) {
      if (secret.length < MIN_SECRET_LENGTH) continue;
      forms.add(secret);
      forms.add(encodeURIComponent(secret));
      forms.add(new URLSearchParams({ v: secret }).toString().slice(2));
    }
    this.secrets = [...forms].sort((a, b) => b.length - a.length);
  }
  /** Redacted text, bounded to `max` characters with an explicit marker. */
  text(value: string, max = 2000): string {
    let text = this.values(value);
    for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
    return bound(text, max);
  }
  private values(value: string) {
    let text = value;
    for (const secret of this.secrets) text = text.replaceAll(secret, MARKER);
    return text;
  }
  /** URL without userinfo or fragment and with sensitive query values removed. */
  url(value: string, max = 500): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return this.text(value, max);
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const name of new Set(url.searchParams.keys()))
      if (SENSITIVE_NAME.test(name)) url.searchParams.set(name, MARKER);
    return bound(this.values(url.toString()), max);
  }
  /** `scheme://host[:port]` only; never a path or query. */
  origin(value: string): string {
    try {
      const url = new URL(value);
      return url.origin === 'null' ? `${url.protocol}${url.pathname}`.slice(0, 100) : url.origin;
    } catch {
      return 'invalid';
    }
  }
}
