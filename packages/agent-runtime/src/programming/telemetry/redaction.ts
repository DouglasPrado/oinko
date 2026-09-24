import { createHash } from 'node:crypto';
import { maskPersonalIdentifiers } from '@oinko/core';
import type { CapturePolicy } from '../contracts.js';

export const REDACTED = '[redacted]';
const MIN_LITERAL = 6;

/** Keys whose values are dropped whole, compared after normalization. */
const SENSITIVE_KEYS = new Set([
  'accesstoken',
  'apikey',
  'apitoken',
  'authorization',
  'proxyauthorization',
  'clientsecret',
  'cookie',
  'setcookie',
  'credential',
  'credentials',
  'password',
  'passwd',
  'passphrase',
  'privatekey',
  'refreshtoken',
  'secret',
  'sessionid',
  'token',
  'xapikey',
  'xaccesstoken',
  'githubtoken',
  'installationtoken',
]);
/** Environment-style names: GITHUB_TOKEN, DB_PASSWORD, STRIPE_SECRET_KEY... */
const SENSITIVE_NAME = /(?:^|[_-])(token|secret|password|passwd|apikey|api_key|private_key|privatekey|credentials?)(?:$|[_-])/i;

const PATTERNS: readonly [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`],
  [/\b(?:token|basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, REDACTED],
  // Credentials embedded in URLs: https://user:pass@host, x-access-token:...@
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
  // Query parameters that carry secrets.
  [
    /([?&](?:access_token|token|api_key|apikey|key|secret|password|signature|sig|auth)=)[^&\s#"']+/gi,
    `$1${REDACTED}`,
  ],
  // KEY=value / KEY: value lines where the name is sensitive.
  [
    /\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY)[A-Za-z0-9_]*)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s"',;]+)/gi,
    `$1=${REDACTED}`,
  ],
  [/\b(?:senha|password|passwd|pwd)\s*[:=]\s*\S+/gi, REDACTED],
  [/\b(authorization|cookie|set-cookie)\s*:\s*[^\n\r]+/gi, `$1: ${REDACTED}`],
];

function normalize(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}
function sensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalize(key)) || SENSITIVE_NAME.test(key);
}

export function redactText(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of [...secrets].filter((value) => value.length >= MIN_LITERAL).sort((a, b) => b.length - a.length))
    out = out.split(secret).join(REDACTED);
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return maskPersonalIdentifiers(out, REDACTED);
}

/**
 * Structural redaction: returns the same shape with secrets removed, so the
 * result can be persisted, queried and rendered. Always applied before any
 * write or transmission, whatever the capture policy.
 */
export function redactValue(value: unknown, secrets: readonly string[] = [], seen = new Set<object>()): unknown {
  if (typeof value === 'string') return redactText(value, secrets);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets, seen));
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) continue;
      out[key] =
        sensitiveKey(key) && (typeof nested === 'string' || typeof nested === 'number')
          ? REDACTED
          : sensitiveKey(key) && nested && typeof nested === 'object'
            ? REDACTED
            : redactValue(nested, secrets, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

export function hashText(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

const MAX_STRING = 64 * 1024;

/**
 * Applies full/hashed/none to an already redacted payload. `safe` lists
 * fields that hold enums/identifiers/counters (never user content) and are
 * kept under every policy so auditing still works with capture `none`.
 */
export function applyCapture(
  payload: Record<string, unknown> | undefined,
  capture: CapturePolicy,
  safe: readonly string[] = [],
): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  const keep = new Set(safe);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (keep.has(key) || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
      continue;
    }
    if (capture === 'none') continue;
    out[key] = capture === 'hashed' ? hashLeaves(value) : truncateLeaves(value);
  }
  return Object.keys(out).length ? out : undefined;
}

function hashLeaves(value: unknown): unknown {
  if (typeof value === 'string') return { hash: hashText(value), length: value.length };
  if (Array.isArray(value)) return value.map(hashLeaves);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, hashLeaves(nested)]));
  return value;
}
function truncateLeaves(value: unknown): unknown {
  if (typeof value === 'string')
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…[truncated ${value.length - MAX_STRING} chars]`
      : value;
  if (Array.isArray(value)) return value.slice(0, 500).map(truncateLeaves);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, truncateLeaves(nested)]));
  return value;
}
