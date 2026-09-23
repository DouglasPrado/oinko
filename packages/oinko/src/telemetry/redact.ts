import { truncateMiddle } from '../utils/truncate.js';
import { SECRET_PATTERNS, maskPersonalIdentifiers } from '../utils/sensitive-data.js';

/** Marker written in place of anything that was scrubbed. */
export const REDACTED = '[redacted]';

const CIRCULAR = '[circular]';
const DEFAULT_MAX_CHARS = 32_768;

/**
 * Literal secrets shorter than this are ignored: a two-letter "secret" would
 * shred ordinary prose without protecting anything.
 */
const MIN_LITERAL_SECRET_LENGTH = 8;

/**
 * Keys whose value is dropped wholesale, matched on the normalised name.
 *
 * Matching is exact rather than substring on purpose: `total_tokens` and
 * `prompt_tokens` normalise to something other than `token`, and a substring
 * rule would erase the usage counts that the telemetry exists to record.
 */
const SENSITIVE_KEYS = new Set([
  'accesstoken',
  'apikey',
  'apitoken',
  'authorization',
  'clientsecret',
  'cookie',
  'password',
  'passwd',
  'privatekey',
  'refreshtoken',
  'secret',
  'setcookie',
  'token',
  'xapikey',
]);

export interface RedactOptions {
  /**
   * Literal values to scrub verbatim — typically the agent's own `apiKey`,
   * which can reach a payload through a header or a prompt that quotes it.
   */
  secrets?: readonly string[];
  /** Character budget for the result. Default 32768. */
  maxChars?: number;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

function redactText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join(REDACTED);
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  // A prompt carries whatever the user typed and every memory injected into
  // it — CPF, CNPJ and card numbers have no business in the telemetry store.
  return maskPersonalIdentifiers(out, REDACTED);
}

function walk(value: unknown, secrets: readonly string[], seen: Set<object>): unknown {
  if (typeof value === 'string') return redactText(value, secrets);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;

  // Only a real cycle counts: a node reached twice through different branches
  // is fine, so the mark is lifted on the way out.
  if (seen.has(value)) return CIRCULAR;
  seen.add(value);

  try {
    if (Array.isArray(value)) return value.map((item) => walk(item, secrets, seen));

    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = SENSITIVE_KEYS.has(normalizeKey(key)) ? REDACTED : walk(nested, secrets, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Scrubs credentials out of a value and renders it for storage.
 *
 * A string comes back as a string, because a system prompt stored JSON-quoted
 * would be unreadable in the UI; anything else is serialised. The result is
 * truncated to `maxChars`, so a caller can hand this an arbitrarily large
 * request body without thinking about it.
 *
 * Redaction happens here, on the way in — never as a cleanup pass over data
 * already written.
 */
export function redactSecrets(value: unknown, options?: RedactOptions): string {
  const secrets = (options?.secrets ?? []).filter(
    (secret) => secret.length >= MIN_LITERAL_SECRET_LENGTH,
  );

  const redacted = walk(value, secrets, new Set());
  const text = typeof redacted === 'string' ? redacted : serialize(redacted);

  return truncateMiddle(text, options?.maxChars ?? DEFAULT_MAX_CHARS);
}
