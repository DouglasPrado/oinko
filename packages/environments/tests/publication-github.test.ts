/* eslint-disable @typescript-eslint/no-explicit-any -- runner results are JSON */
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GithubClient,
  InstallationTokens,
  TOKEN_PERMISSIONS,
  TOKEN_REFRESH_MARGIN_MS,
  appJwt,
  parsePrivateKey,
} from '../src/publication/github.js';
import { FakeGithub, PublicationFixture, rsaKey } from './helpers/publication.js';

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());

describe('GitHub App JWT', () => {
  it('signs RS256 with iat backdated 60 s, exp at most 9 minutes ahead and iss = app id', () => {
    const { pem, publicKey } = rsaKey();
    const { key } = parsePrivateKey(pem);
    const now = Date.UTC(2026, 8, 24, 12, 0, 0);
    const jwt = appJwt('4242', key, now);
    const [header, payload, signature] = jwt.split('.') as [string, string, string];
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = decode(payload);
    expect(claims).toEqual({ iat: now / 1000 - 60, exp: now / 1000 + 540, iss: '4242' });
    expect(claims.exp - now / 1000).toBeLessThanOrEqual(9 * 60);
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
    // Another key does not verify it.
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        rsaKey().publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(false);
  });

  it('accepts only RSA keys of at least 2048 bits and fingerprints them like GitHub', () => {
    const { pem, publicKey } = rsaKey();
    const expected = `SHA256:${createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('base64')}`;
    expect(parsePrivateKey(pem).fingerprint).toBe(expected);
    expect(() => parsePrivateKey('not a key')).toThrow(/inválida/);
    expect(() => parsePrivateKey(rsaKey(1024).pem)).toThrow(/2048/);
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expect(() => parsePrivateKey(ec)).toThrow(/RSA/);
  });
});

describe('installation tokens', () => {
  let github: FakeGithub;
  afterEach(async () => github?.close());
  async function broker(now: () => number) {
    github = await new FakeGithub().start();
    github.installations.set(7, {
      account: 'acme',
      permissions: { ...TOKEN_PERMISSIONS, metadata: 'read' },
      repositories: ['acme/app', 'acme/api'],
    });
    const { key } = parsePrivateKey(github.key.pem);
    const client = new GithubClient(github.url, 2_000, now);
    const issued: string[] = [];
    return {
      tokens: new InstallationTokens(
        client,
        () => appJwt(github.appId, key, Date.now()),
        now,
        (token) => issued.push(token),
      ),
      issued,
    };
  }

  it('asks for exactly one repository and the minimal permissions, and caches per repository', async () => {
    let clock = Date.now();
    const { tokens, issued } = await broker(() => clock);
    const first = await tokens.token(7, 'acme', 'app');
    expect(first.fresh).toBe(true);
    expect(first.token).toMatch(/^ghs_/);
    const request = github.requests.find((item) => item.path.endsWith('/access_tokens'))!;
    expect(request.auth).toBe('jwt');
    expect(request.body).toEqual({
      repositories: ['app'],
      permissions: { contents: 'write', pull_requests: 'write', checks: 'read', statuses: 'read' },
    });
    expect(await tokens.token(7, 'acme', 'app')).toEqual({ token: first.token, fresh: false });
    // Another repository never reuses the token of the first one.
    const api = await tokens.token(7, 'acme', 'api');
    expect(api.token).not.toBe(first.token);
    expect(github.tokens.get(api.token)!.repositories).toEqual(['acme/api']);
    // Refreshed before GitHub's expiry, not after.
    clock += 60 * 60 * 1000 - TOKEN_REFRESH_MARGIN_MS + 1_000;
    const refreshed = await tokens.token(7, 'acme', 'app');
    expect(refreshed.fresh).toBe(true);
    expect(refreshed.token).not.toBe(first.token);
    expect(issued).toHaveLength(3);
  });

  it('refreshes a token that GitHub issued close to expiry and deduplicates concurrent requests', async () => {
    const { tokens } = await broker(() => Date.now());
    github.tokenTtlMs = 4 * 60 * 1000; // inside the refresh margin
    const [a, b] = await Promise.all([
      tokens.token(7, 'acme', 'app'),
      tokens.token(7, 'acme', 'app'),
    ]);
    expect(a.token).toBe(b.token);
    expect(github.requests.filter((item) => item.path.endsWith('/access_tokens'))).toHaveLength(1);
    const next = await tokens.token(7, 'acme', 'app');
    expect(next.fresh).toBe(true);
    expect(next.token).not.toBe(a.token);
  });

  it('diagnoses removed installation, inaccessible repository and missing permission', async () => {
    const { tokens } = await broker(() => Date.now());
    await expect(tokens.token(99, 'acme', 'app')).rejects.toMatchObject({
      code: 'installation_not_found',
      status: 404,
    });
    await expect(tokens.token(7, 'acme', 'private')).rejects.toMatchObject({
      code: 'repository_not_accessible',
    });
    github.installations.get(7)!.permissions.pull_requests = 'read';
    await expect(tokens.token(7, 'acme', 'app')).rejects.toMatchObject({
      code: 'insufficient_permissions',
    });
    github.installations.get(7)!.permissions.pull_requests = 'write';
    github.fault({ method: 'POST', path: /access_tokens$/, kind: 'status', status: 403 });
    await expect(tokens.token(7, 'acme', 'app')).rejects.toMatchObject({
      code: 'insufficient_permissions',
      status: 403,
    });
    github.fault({ method: 'POST', path: /access_tokens$/, kind: 'status', status: 401 });
    await expect(tokens.token(7, 'acme', 'app')).rejects.toMatchObject({
      code: 'app_auth_failed',
      status: 401,
    });
  });
});

describe('expired or revoked installation token during publication', () => {
  let fixture: PublicationFixture | undefined;
  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });
  it('replaces a token that GitHub rejects with 401 once, without surfacing it', async () => {
    fixture = await new PublicationFixture().setup();
    fixture.write('src/index.ts', 'export const value = 2;\n');
    expect(
      (await fixture.call(fixture.publishCommand('op-401', await fixture.revision()))).ok,
    ).toBe(true);
    const before = fixture.github.issued.length;
    // GitHub revokes every token it issued (expiry, key rotation on GitHub's side).
    fixture.github.tokens.clear();
    const update = await fixture.call({
      action: 'ensureDraftPullRequest',
      taskId: 'change',
      repositoryId: 'app',
      operationId: 'pr-401',
      title: 'Novo',
      body: 'Corpo',
    });
    expect(update).toMatchObject({ ok: true, resolution: 'updated' });
    expect(fixture.github.issued.length).toBe(before + 1);
    expect(
      fixture.github.requests.some(
        (request) => request.auth === 'token' && request.method === 'GET',
      ),
    ).toBe(true);
  });
});

describe('GitHub App configuration and installation diagnostics', () => {
  let fixture: PublicationFixture | undefined;
  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('stores the private key encrypted outside the database, returns only metadata and rotates', async () => {
    fixture = await new PublicationFixture().setup();
    const status = await fixture.call({ action: 'githubAppStatus', verify: true }, null);
    expect(status).toMatchObject({
      ok: true,
      configured: true,
      appId: '4242',
      keyAvailable: true,
      verified: { ok: true, slug: 'oinko-test' },
    });
    expect(status.fingerprint).toBe(parsePrivateKey(fixture.github.key.pem).fingerprint);
    expect(JSON.stringify(status)).not.toContain('PRIVATE KEY');
    const keyFile = join(fixture.root, '.harness/publication.key');
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(statSync(keyFile).size).toBe(32);
    const body = fixture.github.key.pem.split('\n')[1]!;
    expect(
      readFileSync(join(fixture.root, '.harness/publication.db')).includes(Buffer.from(body)),
    ).toBe(false);
    // Bots learn only whether publication is configured.
    expect(await fixture.call({ action: 'githubAppStatus' }, 'coder')).toEqual({
      ok: true,
      configured: true,
    });
    expect(
      await fixture.call(
        { action: 'saveGithubApp', appId: '1', privateKeyPem: fixture.github.key.pem },
        'coder',
      ),
    ).toMatchObject({ ok: false, error: { code: 'admin_only' } });

    // A token issued with the old key, then rotation.
    expect(
      (await fixture.call({ action: 'githubInstallation', projectId: 'shop' }, null)).status,
    ).toBe('ready');
    const oldToken = fixture.github.issued.at(-1);
    const previous = fixture.github.key;
    fixture.github.key = rsaKey();
    expect(
      (await fixture.call({ action: 'githubAppStatus', verify: true }, null)).verified,
    ).toMatchObject({ ok: false, code: 'app_auth_failed' });
    const rotated = await fixture.call(
      {
        action: 'saveGithubApp',
        appId: fixture.github.appId,
        privateKeyPem: fixture.github.key.pem,
        apiUrl: fixture.github.url,
        gitUrl: `file://${fixture.remotes}`,
      },
      null,
    );
    expect(rotated.fingerprint).not.toBe(parsePrivateKey(previous.pem).fingerprint);
    expect(rotated.rotatedAt >= status.rotatedAt).toBe(true);
    expect(
      (await fixture.call({ action: 'githubAppStatus', verify: true }, null)).verified.ok,
    ).toBe(true);
    expect(
      (await fixture.call({ action: 'githubInstallation', projectId: 'shop' }, null)).status,
    ).toBe('ready');
    expect(fixture.github.issued.at(-1)).not.toBe(oldToken);
    expect(
      readFileSync(join(fixture.root, '.harness/publication.db')).includes(
        Buffer.from(fixture.github.key.pem.split('\n')[1]!),
      ),
    ).toBe(false);
  });

  it('reports a missing master key explicitly and recovers when the App is saved again', async () => {
    fixture = await new PublicationFixture().setup();
    rmSync(join(fixture.root, '.harness/publication.key'));
    const extension = fixture.newExtension();
    try {
      expect(await fixture.call({ action: 'githubAppStatus' }, null, extension)).toMatchObject({
        configured: true,
        keyAvailable: false,
      });
      fixture.write('src/index.ts', 'export const value = 2;\n');
      const blocked = await fixture.call(
        fixture.publishCommand('op-key', await fixture.revision()),
        'coder',
        extension,
      );
      expect(blocked).toMatchObject({ ok: false, error: { code: 'master_key_missing' } });
      await fixture.call(
        {
          action: 'saveGithubApp',
          appId: fixture.github.appId,
          privateKeyPem: fixture.github.key.pem,
          apiUrl: fixture.github.url,
          gitUrl: `file://${fixture.remotes}`,
        },
        null,
        extension,
      );
      expect(await fixture.call({ action: 'githubAppStatus' }, null, extension)).toMatchObject({
        keyAvailable: true,
      });
    } finally {
      await extension.close();
    }
  });

  it('distinguishes installed from effectively accessible per repository', async () => {
    fixture = await new PublicationFixture(['app', 'api']).setup();
    const ready = await fixture.call({ action: 'githubInstallation', projectId: 'shop' }, null);
    expect(ready).toMatchObject({ ok: true, status: 'ready', installed: true, ready: true });
    expect(ready.repositories.map((repo: any) => repo.access)).toEqual(['valid', 'valid']);
    fixture.github.installations.get(42)!.repositories = ['acme/app'];
    const partial = await fixture.call(
      { action: 'githubInstallation', projectId: 'shop' },
      'coder',
    );
    expect(partial).toMatchObject({
      status: 'repositories_not_accessible',
      installed: true,
      ready: false,
    });
    expect(partial.repositories).toEqual([
      expect.objectContaining({ repositoryId: 'app', access: 'valid' }),
      expect.objectContaining({
        repositoryId: 'api',
        access: 'denied',
        code: 'repository_not_accessible',
      }),
    ]);
    fixture.github.installations.get(42)!.permissions.pull_requests = 'read';
    const permissions = await fixture.call(
      { action: 'githubInstallation', projectId: 'shop' },
      null,
    );
    expect(permissions).toMatchObject({
      status: 'insufficient_permissions',
      installation: { missingPermissions: ['pull_requests:write'] },
    });
    fixture.github.installations.get(42)!.permissions.pull_requests = 'write';
    fixture.github.installations.get(42)!.suspended = true;
    expect(
      (await fixture.call({ action: 'githubInstallation', projectId: 'shop' }, null)).status,
    ).toBe('installation_suspended');
    fixture.github.installations.delete(42);
    const removed = await fixture.call({ action: 'githubInstallation', projectId: 'shop' }, null);
    expect(removed).toMatchObject({
      status: 'installation_not_found',
      installed: false,
      ready: false,
    });
    // The same removal during publication is explicit, never a request for a personal token.
    fixture.write('src/index.ts', 'export const value = 2;\n');
    // A runner without a cached token (tokens live at most one hour in memory).
    const fresh = fixture.newExtension();
    const publish = await fixture.call(
      fixture.publishCommand('op-removed', await fixture.revision()),
      'coder',
      fresh,
    );
    await fresh.close();
    expect(publish).toMatchObject({ ok: false, error: { code: 'installation_not_found' } });
    expect(publish.push).toBeUndefined();
    expect(fixture.remoteSha()).toBeUndefined();
    expect(JSON.stringify(publish)).not.toMatch(/\bPAT\b|personal access token|token pessoal/i);
    const events = await fixture.events();
    expect(
      events
        .filter((event) => event.type === 'github_installation_checked')
        .map((event) => event.payload.result),
    ).toEqual([
      'ready',
      'repositories_not_accessible',
      'insufficient_permissions',
      'installation_suspended',
      'installation_not_found',
    ]);
    expect(events.find((event) => event.type === 'github_permission_denied')).toMatchObject({
      payload: { repository: 'api', code: 'repository_not_accessible' },
    });
    expect(events.find((event) => event.type === 'github_token_issued')).toMatchObject({
      payload: { installationId: 42 },
    });
  });

  it('diagnoses a rejected JWT and a skewed clock', async () => {
    fixture = await new PublicationFixture().setup();
    const skewed = fixture.newExtension({ now: () => Date.now() + 20 * 60 * 1000 });
    try {
      const skew = await fixture.call(
        { action: 'githubInstallation', projectId: 'shop' },
        null,
        skewed,
      );
      expect(skew).toMatchObject({ status: 'clock_skew', installed: null });
      expect(skew.error.details.skewSeconds).toBeGreaterThan(1000);
    } finally {
      await skewed.close();
    }
    fixture.github.key = rsaKey(); // GitHub now expects another key
    const rejected = await fixture.call({ action: 'githubInstallation', projectId: 'shop' }, null);
    expect(rejected).toMatchObject({ status: 'app_auth_failed', installed: null });
  });
});
