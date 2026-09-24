/**
 * Secret detection for content about to leave the runner (pushed commits,
 * commit messages, PR text) and redaction for everything the runner returns.
 * Findings carry paths and rule names only — never the matched value.
 */

export interface SecretFinding {
  path: string;
  rules: string[];
}

const CONTENT_RULES: readonly [string, RegExp][] = [
  ['private_key', /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/],
  ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['aws_access_key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['slack_token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['api_key', /\bsk-(?:ant-|proj-|or-v1-|live-)?[A-Za-z0-9_-]{20,}/],
  ['stripe_key', /\b[rs]k_live_[0-9A-Za-z]{20,}/],
  ['google_api_key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['npm_token', /\bnpm_[A-Za-z0-9]{36}\b|_authToken\s*=\s*(?!\$\{)[^\s'"]{8,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
];
/** `.env`-style assignment of a literal to a sensitive name. */
const ASSIGNMENT =
  /^\s*(?:export\s+)?[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|CREDENTIALS?)[A-Za-z0-9_]*\s*=\s*(['"]?)([^\s'"#]{8,})\1\s*(?:#.*)?$/;
const PLACEHOLDER =
  /^(?:\$|<|\{\{|%\(|x{4,}|\*{4,}|\.{3})|^(?:changeme|change_me|your[_-].*|example.*|placeholder|dummy|sample|null|none|undefined|redacted|\[redacted\])$/i;
/** Credentials embedded in a URL: scheme://user:secret@host. */
const URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]*:\/\/([^\s/:@'"]+):([^\s/@'"]{3,})@/i;

const PATH_RULES: readonly [string, RegExp][] = [
  ['env_file', /(?:^|\/)\.env(?:\.(?!example$|sample$|template$|dist$|defaults?$)[^/]+)?$/i],
  ['ssh_private_key', /(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$/],
  ['keystore', /\.(?:p12|pfx|jks|keystore|ppk)$/i],
  ['credentials_file', /(?:^|\/)(?:\.git-credentials|\.netrc|_netrc|\.pgpass)$/],
];

export function pathRules(path: string): string[] {
  return PATH_RULES.filter(([, pattern]) => pattern.test(path)).map(([rule]) => rule);
}

export function lineRules(line: string, known: readonly string[] = []): string[] {
  const rules = new Set<string>();
  for (const [rule, pattern] of CONTENT_RULES) if (pattern.test(line)) rules.add(rule);
  const assignment = ASSIGNMENT.exec(line);
  if (assignment && !PLACEHOLDER.test(assignment[2]!)) rules.add('env_assignment');
  const url = URL_CREDENTIALS.exec(line);
  if (url && !PLACEHOLDER.test(url[2]!) && !/^(?:pass(?:word)?|secret|token)$/i.test(url[2]!))
    rules.add('url_credentials');
  for (const secret of known)
    if (secret.length >= 8 && line.includes(secret)) rules.add('known_secret');
  return [...rules];
}

/** Scans free text (commit message, PR title/body) under a pseudo path. */
export function scanText(label: string, text: string, known: readonly string[] = []) {
  const rules = new Set<string>();
  for (const line of text.split(/\r?\n/))
    for (const rule of lineRules(line, known)) rules.add(rule);
  // A multi-line private key may be split; the header alone is enough.
  return rules.size ? [{ path: label, rules: [...rules].sort() }] : [];
}

function unquote(path: string) {
  if (!path.startsWith('"')) return path;
  try {
    return JSON.parse(
      path.replace(
        /\\([0-7]{3})/g,
        (_, octal: string) => `\\u00${parseInt(octal, 8).toString(16).padStart(2, '0')}`,
      ),
    ) as string;
  } catch {
    return path.slice(1, -1);
  }
}

/**
 * Scans the added lines of a unified patch (`git log -p` output). Only `+`
 * lines count: removing a secret is not a leak, adding one anywhere in the
 * pushed history is.
 */
export function scanPatch(patch: string, known: readonly string[] = []): SecretFinding[] {
  const found = new Map<string, Set<string>>();
  let current: string | undefined;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).replace(/\t$/, '');
      current = target === '/dev/null' ? undefined : unquote(target).replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('diff --git ') || line.startsWith('commit ')) {
      current = undefined;
      continue;
    }
    if (!current || !line.startsWith('+')) continue;
    const rules = lineRules(line.slice(1), known);
    if (!rules.length) continue;
    const set = found.get(current) ?? new Set<string>();
    for (const rule of rules) set.add(rule);
    found.set(current, set);
  }
  return [...found].map(([path, rules]) => ({ path, rules: [...rules].sort() }));
}

export function mergeFindings(...lists: SecretFinding[][]): SecretFinding[] {
  const merged = new Map<string, Set<string>>();
  for (const list of lists)
    for (const finding of list) {
      const set = merged.get(finding.path) ?? new Set<string>();
      for (const rule of finding.rules) set.add(rule);
      merged.set(finding.path, set);
    }
  return [...merged]
    .map(([path, rules]) => ({ path, rules: [...rules].sort() }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

const REDACTIONS: readonly [RegExp, string][] = [
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    '[redacted]',
  ],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redacted]'],
  [/\b(authorization\s*:\s*)(?:basic|bearer|token)\s+[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]'],
  [/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi, '[redacted]'],
  [/(x-access-token:)[^\s@]+/gi, '$1[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, '[redacted]'],
];

/** Removes known secret values and credential-shaped strings from text. */
export class Redactor {
  private readonly values = new Set<string>();
  add(value: string | undefined) {
    if (!value || value.length < 8) return;
    this.values.add(value);
    // The Basic header form of an installation token.
    if (/^gh[a-z]_/.test(value))
      this.values.add(Buffer.from(`x-access-token:${value}`).toString('base64'));
    for (const line of value.split('\n'))
      if (line.length >= 24 && !line.startsWith('-----')) this.values.add(line.trim());
  }
  known(): string[] {
    return [...this.values];
  }
  text(input: string): string {
    let out = input;
    for (const value of [...this.values].sort((a, b) => b.length - a.length))
      out = out.split(value).join('[redacted]');
    for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
    return out;
  }
  deep<T>(value: T): T {
    if (typeof value === 'string') return this.text(value) as T;
    if (Array.isArray(value)) return value.map((item) => this.deep(item)) as T;
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) out[key] = this.deep(item);
      return out as T;
    }
    return value;
  }
}
