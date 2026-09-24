import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';
import { PublicationError } from './errors.js';

/** The only permissions the runner ever requests for an installation token. */
export const TOKEN_PERMISSIONS = {
  contents: 'write',
  pull_requests: 'write',
  checks: 'read',
  statuses: 'read',
} as const;
const LEVEL: Record<string, number> = { read: 1, write: 2, admin: 3 };
/** Refresh a cached token this long before GitHub expires it. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** Tolerated difference between the local clock and GitHub's before blaming the clock. */
const SKEW_TOLERANCE_MS = 30_000;

export function parsePrivateKey(pem: string): { key: KeyObject; fingerprint: string } {
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem, format: 'pem' });
  } catch {
    throw new PublicationError('invalid_private_key', 'Chave privada PEM inválida.');
  }
  const details = key.asymmetricKeyDetails;
  if (key.asymmetricKeyType !== 'rsa' || (details?.modulusLength ?? 0) < 2048)
    throw new PublicationError(
      'invalid_private_key',
      'A chave da GitHub App deve ser RSA de pelo menos 2048 bits.',
    );
  const spki = createPublicKey(key).export({ type: 'spki', format: 'der' });
  return {
    key,
    fingerprint: `SHA256:${createHash('sha256').update(spki).digest('base64')}`,
  };
}

/** GitHub App JWT (RS256): iat backdated 60 s against skew, exp at most 9 min ahead. */
export function appJwt(appId: string, key: KeyObject, nowMs: number): string {
  const now = Math.floor(nowMs / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 60, exp: now + 540, iss: appId })}`;
  return `${unsigned}.${sign('sha256', Buffer.from(unsigned), key).toString('base64url')}`;
}

export function missingPermissions(granted: Record<string, string> | undefined) {
  return Object.entries(TOKEN_PERMISSIONS)
    .filter(([name, level]) => (LEVEL[granted?.[name] ?? ''] ?? 0) < LEVEL[level]!)
    .map(([name, level]) => `${name}:${level}`);
}

export interface GithubResponse<T> {
  status: number;
  headers: Headers;
  data: T;
}
type Json = Record<string, unknown>;

function message(data: unknown) {
  const text = data && typeof data === 'object' ? (data as Json).message : undefined;
  return typeof text === 'string' ? text.slice(0, 300) : '';
}

/** Minimal REST client over native fetch; never follows redirects with credentials. */
export class GithubClient {
  constructor(
    readonly apiUrl: string,
    private readonly timeoutMs: number,
    private readonly now: () => number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async request<T = Json>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    authorization: string,
    body?: unknown,
    kind: 'app' | 'installation' = 'installation',
  ): Promise<GithubResponse<T>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        method,
        redirect: 'manual',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: authorization,
          'User-Agent': 'oinko-runner',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      throw new PublicationError(
        timeout ? 'github_timeout' : 'github_unavailable',
        timeout ? 'O GitHub não respondeu a tempo.' : 'Não foi possível contatar o GitHub.',
        { retryable: true, uncertain: method !== 'GET' },
      );
    }
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      /* non-JSON error page */
    }
    if (response.status >= 200 && response.status < 300)
      return { status: response.status, headers: response.headers, data: data as T };
    throw this.error(response, data, method, kind);
  }
  private error(response: Response, data: unknown, method: string, kind: 'app' | 'installation') {
    const { status, headers } = response;
    const text = message(data);
    const remaining = headers.get('x-ratelimit-remaining');
    if (
      status === 429 ||
      (status === 403 &&
        (remaining === '0' || headers.has('retry-after') || /rate limit/i.test(text)))
    ) {
      const reset = Number(headers.get('x-ratelimit-reset'));
      const retryAfter = Number(headers.get('retry-after'));
      const seconds =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter
          : Number.isFinite(reset) && reset > 0
            ? Math.max(1, Math.ceil(reset - this.now() / 1000))
            : 60;
      return new PublicationError('rate_limited', 'Limite de requisições do GitHub atingido.', {
        retryable: true,
        status,
        details: {
          retryAfterSeconds: seconds,
          ...(Number.isFinite(reset) &&
            reset > 0 && { resetAt: new Date(reset * 1000).toISOString() }),
        },
      });
    }
    if (status >= 300 && status < 400)
      return new PublicationError(
        'github_redirect',
        'O GitHub redirecionou a requisição (repositório renomeado ou movido?). Atualize o vínculo do projeto.',
        { status },
      );
    if (status === 401) {
      if (kind === 'app') {
        const server = Date.parse(headers.get('date') ?? '');
        const skew = Number.isFinite(server) ? Math.abs(server - this.now()) : 0;
        if (skew > SKEW_TOLERANCE_MS)
          return new PublicationError(
            'clock_skew',
            'O GitHub recusou o JWT da App: o relógio desta máquina está defasado. Sincronize o horário (NTP).',
            { status, details: { skewSeconds: Math.round(skew / 1000) } },
          );
        return new PublicationError(
          'app_auth_failed',
          'O GitHub recusou o JWT da App. Confira o App ID e a chave privada (ou rotacione a chave).',
          { status },
        );
      }
      return new PublicationError(
        'github_unauthorized',
        'Token de instalação recusado pelo GitHub.',
        {
          status,
          retryable: true,
        },
      );
    }
    if (status === 403)
      return new PublicationError(
        'permission_denied',
        `O GitHub negou a operação por falta de permissão da App.${text ? ` (${text})` : ''}`,
        { status },
      );
    if (status === 404)
      return new PublicationError('not_found', 'Recurso não encontrado no GitHub.', { status });
    if (status === 422)
      return new PublicationError(
        'github_validation_failed',
        `O GitHub recusou a requisição: ${text || 'dados inválidos'}.`,
        {
          status,
          details: {
            githubMessage: text,
            errors: JSON.stringify((data as Json | undefined)?.errors ?? []).slice(0, 500),
          },
        },
      );
    return new PublicationError('github_unavailable', `O GitHub respondeu ${status}.`, {
      status,
      retryable: status >= 500,
      uncertain: method !== 'GET' && status >= 500,
    });
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Short-lived installation tokens restricted to one repository and to
 * TOKEN_PERMISSIONS. Cached in memory only, per (installation, repository),
 * and refreshed before expiry. Tokens never reach the caller.
 */
export class InstallationTokens {
  private readonly cache = new Map<string, CachedToken>();
  private readonly pending = new Map<string, Promise<string>>();
  constructor(
    private readonly client: GithubClient,
    private readonly jwt: () => string,
    private readonly now: () => number,
    private readonly issued: (token: string) => void,
  ) {}
  /** `fresh` tells whether GitHub was asked for a new token (telemetry). */
  async token(
    installationId: number,
    owner: string,
    name: string,
  ): Promise<{ token: string; fresh: boolean }> {
    const key = `${installationId}:${owner}/${name}`.toLowerCase();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt - this.now() > TOKEN_REFRESH_MARGIN_MS)
      return { token: cached.token, fresh: false };
    const running = this.pending.get(key);
    if (running) return { token: await running, fresh: false };
    const request = this.issue(installationId, owner, name, key).finally(() =>
      this.pending.delete(key),
    );
    this.pending.set(key, request);
    return { token: await request, fresh: true };
  }
  private async issue(installationId: number, owner: string, name: string, key: string) {
    let response: GithubResponse<Json>;
    try {
      response = await this.client.request<Json>(
        'POST',
        `/app/installations/${installationId}/access_tokens`,
        `Bearer ${this.jwt()}`,
        { repositories: [name], permissions: TOKEN_PERMISSIONS },
        'app',
      );
    } catch (error) {
      if (!(error instanceof PublicationError)) throw error;
      if (error.code === 'not_found')
        throw new PublicationError(
          'installation_not_found',
          'A instalação da GitHub App foi removida ou não pertence a esta App.',
          { status: 404 },
        );
      if (
        error.code === 'permission_denied' ||
        (error.code === 'github_validation_failed' &&
          /permission/i.test(String(error.details?.githubMessage ?? '')))
      )
        throw new PublicationError(
          'insufficient_permissions',
          'A instalação não concedeu as permissões necessárias (contents/pull_requests: write; checks/statuses: read). Atualize as permissões da App e aceite na instalação.',
          { status: error.status ?? 403 },
        );
      if (error.code === 'github_validation_failed')
        throw new PublicationError(
          'repository_not_accessible',
          `A instalação não tem acesso ao repositório ${owner}/${name}. Inclua-o na instalação da App.`,
          { status: 422 },
        );
      throw error;
    }
    const data = response.data;
    const token = typeof data.token === 'string' ? data.token : '';
    const expiresAt = Date.parse(String(data.expires_at ?? ''));
    if (!token || !Number.isFinite(expiresAt))
      throw new PublicationError(
        'github_unavailable',
        'Resposta inválida ao emitir token de instalação.',
      );
    const granted = (data.permissions ?? {}) as Record<string, string>;
    const exceeding = Object.entries(granted).filter(
      ([permission, level]) =>
        permission !== 'metadata' &&
        (LEVEL[level] ?? 3) >
          (LEVEL[(TOKEN_PERMISSIONS as Record<string, string>)[permission] ?? ''] ?? 0),
    );
    const repositories = Array.isArray(data.repositories) ? (data.repositories as Json[]) : [];
    if (
      exceeding.length ||
      missingPermissions(granted).length ||
      repositories.some((repo) => String(repo.name).toLowerCase() !== name.toLowerCase())
    )
      throw new PublicationError(
        'insufficient_permissions',
        'O token emitido não corresponde ao escopo mínimo pedido; publicação recusada.',
      );
    this.issued(token);
    this.cache.set(key, { token, expiresAt });
    return token;
  }
  invalidate(installationId?: number, owner?: string, name?: string) {
    if (installationId === undefined) return this.cache.clear();
    const key = `${installationId}:${owner}/${name}`.toLowerCase();
    this.cache.delete(key);
  }
}
