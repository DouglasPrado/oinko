/* eslint-disable @typescript-eslint/no-explicit-any -- fake GitHub payloads are untyped JSON */
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes, verify, type KeyObject } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { RunnerCommand, type RunnerCommandInput } from '../../src/contracts/requests.js';
import { PublicationExtension, type PublicationOptions } from '../../src/publication/extension.js';
import { localPublicationSandbox } from '../../src/publication/sandbox.js';
import { EnvironmentController } from '../../src/runtime/controller.js';
import { runOpsLocally } from '../../src/workspace/ops.js';

export const FULL_PERMISSIONS = {
  contents: 'write',
  pull_requests: 'write',
  checks: 'read',
  statuses: 'read',
  metadata: 'read',
};

export function rsaKey(bits = 2048) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: bits });
  return {
    pem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    publicKey,
  };
}

interface Installation {
  account: string;
  permissions: Record<string, string>;
  repositories: string[];
  suspended?: boolean;
}
interface Fault {
  method: string;
  path: RegExp;
  kind: 'drop' | 'delay_after' | 'status';
  status?: number;
  headers?: Record<string, string>;
  delayMs?: number;
  times: number;
}

/** In-process GitHub REST double; verifies App JWTs and token scopes like GitHub. */
export class FakeGithub {
  readonly appId = '4242';
  key = rsaKey();
  readonly installations = new Map<number, Installation>();
  readonly tokens = new Map<
    string,
    { installationId: number; repositories: string[]; permissions: any; expiresAt: number }
  >();
  readonly issued: string[] = [];
  tokenTtlMs = 60 * 60 * 1000;
  readonly pulls: any[] = [];
  readonly checkRuns = new Map<string, any[]>();
  readonly statuses = new Map<string, any[]>();
  branch: any = { protected: false };
  rules: any = [];
  readonly requests: { method: string; path: string; auth: string; body?: any }[] = [];
  readonly jwtClaims: any[] = [];
  readonly faults: Fault[] = [];
  private server?: Server;
  url = '';

  async start() {
    this.server = createServer((request, response) => void this.route(request, response));
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
    return this;
  }
  async close() {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }
  fault(fault: Omit<Fault, 'times'> & { times?: number }) {
    this.faults.push({ times: 1, ...fault });
  }
  pullsFor(owner: string, name: string) {
    return this.pulls.filter((pr) => pr.base.repo.full_name === `${owner}/${name}`);
  }
  private send(
    response: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    response.writeHead(status, {
      'Content-Type': 'application/json',
      Date: new Date().toUTCString(),
      ...headers,
    });
    response.end(body === undefined ? '' : JSON.stringify(body));
  }
  private jwt(authorization: string): boolean {
    const token = authorization.replace(/^Bearer /, '');
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) return false;
    const valid = verify(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      this.key.publicKey as KeyObject,
      Buffer.from(signature, 'base64url'),
    );
    const head = JSON.parse(Buffer.from(header, 'base64url').toString());
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    this.jwtClaims.push({ header: head, claims, valid });
    const now = Math.floor(Date.now() / 1000);
    return (
      valid &&
      head.alg === 'RS256' &&
      claims.iss === this.appId &&
      claims.iat <= now + 30 &&
      claims.exp > now &&
      claims.exp <= now + 600 &&
      claims.exp - claims.iat <= 600
    );
  }
  private installationToken(authorization: string, repository: string) {
    const value = authorization.replace(/^Bearer /, '');
    const token = this.tokens.get(value);
    // Like GitHub: removing the installation revokes its tokens; access is checked live.
    const installation = token && this.installations.get(token.installationId);
    if (!token || !installation || token.expiresAt < Date.now()) return 'expired';
    return token.repositories.includes(repository) && installation.repositories.includes(repository)
      ? token
      : undefined;
  }
  private async route(request: IncomingMessage, response: ServerResponse) {
    let text = '';
    for await (const chunk of request) text += String(chunk);
    const body = text ? JSON.parse(text) : undefined;
    const url = new URL(request.url ?? '/', this.url);
    const path = url.pathname;
    const method = request.method ?? 'GET';
    const authorization = String(request.headers.authorization ?? '');
    this.requests.push({
      method,
      path: `${path}${url.search}`,
      auth: authorization.startsWith('Bearer ghs_')
        ? 'token'
        : authorization.startsWith('Bearer ey')
          ? 'jwt'
          : 'none',
      body,
    });
    const fault = this.faults.find(
      (item) => item.times > 0 && item.method === method && item.path.test(path),
    );
    if (fault) {
      fault.times--;
      if (fault.kind === 'drop') {
        request.socket.destroy();
        return;
      }
      if (fault.kind === 'status')
        return this.send(response, fault.status!, { message: 'fault' }, fault.headers);
    }
    const reply = (status: number, data: unknown, headers?: Record<string, string>) => {
      if (fault?.kind === 'delay_after')
        void delay(fault.delayMs ?? 1000).then(() => {
          if (!response.destroyed) this.send(response, status, data, headers);
        });
      else this.send(response, status, data, headers);
    };
    try {
      this.handle(method, path, url, authorization, body, reply);
    } catch (error) {
      this.send(response, 500, { message: String(error) });
    }
  }
  private handle(
    method: string,
    path: string,
    url: URL,
    authorization: string,
    body: any,
    reply: (status: number, data: unknown, headers?: Record<string, string>) => void,
  ) {
    let match: RegExpMatchArray | null;
    if (path.startsWith('/app')) {
      if (!this.jwt(authorization))
        return reply(401, { message: "'Expiration time' claim ('exp') is too far in the future" });
      if (method === 'GET' && path === '/app')
        return reply(200, { id: Number(this.appId), slug: 'oinko-test', name: 'Oinko Test' });
      if ((match = path.match(/^\/app\/installations\/(\d+)$/)) && method === 'GET') {
        const installation = this.installations.get(Number(match[1]));
        if (!installation) return reply(404, { message: 'Not Found' });
        return reply(200, {
          id: Number(match[1]),
          account: { login: installation.account, type: 'Organization' },
          repository_selection: 'selected',
          permissions: installation.permissions,
          suspended_at: installation.suspended ? new Date().toISOString() : null,
        });
      }
      if (
        (match = path.match(/^\/app\/installations\/(\d+)\/access_tokens$/)) &&
        method === 'POST'
      ) {
        const id = Number(match[1]);
        const installation = this.installations.get(id);
        if (!installation) return reply(404, { message: 'Not Found' });
        const requested = body?.permissions ?? {};
        const level: Record<string, number> = { read: 1, write: 2 };
        if (
          Object.entries(requested).some(
            ([name, value]) =>
              (level[installation.permissions[name] ?? ''] ?? 0) < (level[String(value)] ?? 3),
          )
        )
          return reply(422, {
            message: 'The permissions requested are not granted to this installation.',
          });
        const repositories: string[] = body?.repositories ?? [];
        if (
          !repositories.length ||
          repositories.some(
            (name) => !installation.repositories.includes(`${installation.account}/${name}`),
          )
        )
          return reply(422, {
            message:
              'There is at least one repository that does not exist or is not accessible to the parent installation.',
          });
        const token = `ghs_${randomBytes(27)
          .toString('base64url')
          .replace(/[^A-Za-z0-9]/g, 'x')
          .slice(0, 36)}`;
        const expiresAt = Date.now() + this.tokenTtlMs;
        this.tokens.set(token, {
          installationId: id,
          repositories: repositories.map((name) => `${installation.account}/${name}`),
          permissions: requested,
          expiresAt,
        });
        this.issued.push(token);
        return reply(201, {
          token,
          expires_at: new Date(expiresAt).toISOString(),
          permissions: requested,
          repository_selection: 'selected',
          repositories: repositories.map((name) => ({
            name,
            full_name: `${installation.account}/${name}`,
          })),
        });
      }
      return reply(404, { message: 'Not Found' });
    }
    if ((match = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/))) {
      const full = `${match[1]}/${match[2]}`;
      const rest = match[3] ?? '';
      const token = this.installationToken(authorization, full);
      if (token === 'expired') return reply(401, { message: 'Bad credentials' });
      if (!token) return reply(404, { message: 'Not Found' });
      if (method === 'GET' && rest === '')
        return reply(200, { id: 1, name: match[2], full_name: full, owner: { login: match[1] } });
      if (rest === '/pulls' && method === 'GET') {
        const [, headRef] = String(url.searchParams.get('head') ?? '').split(':');
        return reply(
          200,
          this.pulls.filter(
            (pr) => pr.base.repo.full_name === full && (!headRef || pr.head.ref === headRef),
          ),
        );
      }
      if (rest === '/pulls' && method === 'POST') {
        if (
          this.pulls.some(
            (pr) =>
              pr.base.repo.full_name === full &&
              pr.state === 'open' &&
              pr.head.ref === body.head &&
              pr.base.ref === body.base,
          )
        )
          return reply(422, {
            message: 'Validation Failed',
            errors: [{ message: `A pull request already exists for ${match[1]}:${body.head}.` }],
          });
        const number = this.pulls.length + 1;
        const pr = {
          number,
          title: body.title,
          body: body.body,
          state: 'open',
          draft: !!body.draft,
          merged_at: null,
          html_url: `https://github.test/${full}/pull/${number}`,
          head: { ref: body.head, sha: 'unknown', repo: { full_name: full } },
          base: { ref: body.base, repo: { full_name: full } },
        };
        this.pulls.push(pr);
        return reply(201, pr);
      }
      if ((match = rest.match(/^\/pulls\/(\d+)$/)) && method === 'PATCH') {
        const pr = this.pulls.find(
          (item) => item.number === Number(match![1]) && item.base.repo.full_name === full,
        );
        if (!pr) return reply(404, { message: 'Not Found' });
        Object.assign(pr, body);
        return reply(200, pr);
      }
      if ((match = rest.match(/^\/commits\/([0-9a-f]+)\/check-runs$/)) && method === 'GET') {
        const runs = this.checkRuns.get(match[1]!) ?? [];
        return reply(200, { total_count: runs.length, check_runs: runs });
      }
      if ((match = rest.match(/^\/commits\/([0-9a-f]+)\/status$/)) && method === 'GET') {
        const statuses = this.statuses.get(match[1]!) ?? [];
        return reply(200, {
          sha: match[1],
          state: statuses.length ? statuses[0].state : 'pending',
          statuses,
        });
      }
      if (rest.startsWith('/branches/') && method === 'GET')
        return this.branch === 'forbidden'
          ? reply(403, { message: 'Resource not accessible by integration' })
          : reply(200, this.branch);
      if (rest.startsWith('/rules/branches/') && method === 'GET')
        return this.rules === 'forbidden'
          ? reply(403, { message: 'Resource not accessible by integration' })
          : reply(200, this.rules);
    }
    return reply(404, { message: 'Not Found' });
  }
}

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@localhost',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@localhost',
};
export function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd,
    env: GIT_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Host layout identical to the sandbox mount (`.harness/workspaces/<project>`
 * with `repositories/<repo>` clones and `tasks/<task>/<repo>` worktrees), a
 * local bare "GitHub" remote per repository and the fake API.
 */
export class PublicationFixture {
  readonly root = mkdtempSync(join(tmpdir(), 'oinko-publication-'));
  readonly github = new FakeGithub();
  readonly remotes = join(this.root, 'remotes');
  controller!: EnvironmentController;
  extension!: PublicationExtension;
  readonly outputs: string[] = [];
  constructor(
    readonly repositories: string[] = ['app'],
    private readonly options: PublicationOptions = {},
  ) {}
  async setup() {
    await this.github.start();
    this.controller = new EnvironmentController(this.root);
    this.extension = this.newExtension();
    const workspace = join(this.root, '.harness/workspaces/shop');
    for (const repo of this.repositories) {
      const source = join(this.root, `source-${repo}`);
      mkdirSync(join(source, 'src'), { recursive: true });
      writeFileSync(join(source, 'README.md'), `# ${repo}\n`);
      writeFileSync(join(source, 'src/index.ts'), 'export const value = 1;\n');
      git(source, 'init', '-q', '-b', 'main');
      git(source, 'add', '-A');
      git(source, 'commit', '-q', '-m', 'initial');
      mkdirSync(join(this.remotes, 'acme'), { recursive: true });
      git(this.root, 'clone', '-q', '--bare', source, join(this.remotes, 'acme', `${repo}.git`));
      git(
        this.root,
        'clone',
        '-q',
        '--no-checkout',
        '--no-local',
        source,
        join(workspace, 'repositories', repo),
      );
      git(
        join(workspace, 'repositories', repo),
        'worktree',
        'add',
        '-q',
        '-b',
        'task/change',
        join(workspace, 'tasks/change', repo),
        'main',
      );
    }
    this.controller.workspaces.saveProject(
      {
        id: 'shop',
        name: 'Shop',
        repositories: this.repositories.map((id) => ({
          id,
          source: join(this.root, `source-${id}`),
        })),
        allowedBotIds: ['coder', 'reader'],
        programming: {
          github: {
            installationId: 42,
            repositories: this.repositories.map((id) => ({
              repositoryId: id,
              owner: 'acme',
              name: id,
              baseBranch: 'main',
            })),
          },
          publisherBotIds: ['coder'],
        },
      },
      0,
    );
    this.controller.workspaces.saveTask(
      { id: 'change', projectId: 'shop', name: 'Change', branch: 'task/change', state: 'ready' },
      0,
    );
    this.github.installations.set(42, {
      account: 'acme',
      permissions: { ...FULL_PERMISSIONS },
      repositories: this.repositories.map((id) => `acme/${id}`),
    });
    const saved = await this.call(
      {
        action: 'saveGithubApp',
        appId: this.github.appId,
        privateKeyPem: this.github.key.pem,
        apiUrl: this.github.url,
        gitUrl: `file://${this.remotes}`,
      },
      null,
    );
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    return this;
  }
  newExtension(options: PublicationOptions = {}) {
    return new PublicationExtension({
      sandbox: localPublicationSandbox,
      requestTimeoutMs: 2_000,
      ...this.options,
      ...options,
    });
  }
  /** `botId: null` calls as the installation administrator. */
  async call(
    command: RunnerCommandInput,
    botId: string | null = 'coder',
    extension = this.extension,
    controller = this.controller,
  ): Promise<any> {
    const result = await extension.handle(
      RunnerCommand.parse(command),
      controller.context(botId ?? undefined),
    );
    this.outputs.push(JSON.stringify(result));
    return result;
  }
  worktree(repo = 'app') {
    return join(this.root, '.harness/workspaces/shop/tasks/change', repo);
  }
  clone(repo = 'app') {
    return join(this.root, '.harness/workspaces/shop/repositories', repo);
  }
  remote(repo = 'app') {
    return join(this.remotes, 'acme', `${repo}.git`);
  }
  write(path: string, content: string, repo = 'app') {
    const file = join(this.worktree(repo), path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  }
  async revision(repo = 'app'): Promise<string> {
    return (
      (await runOpsLocally({ root: this.worktree(repo), op: 'treeHash' })) as { revision: string }
    ).revision;
  }
  remoteSha(branch = 'task/change', repo = 'app') {
    try {
      return git(this.remote(repo), 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
    } catch {
      return undefined;
    }
  }
  async events(type?: string) {
    const result = await this.call({ action: 'publicationEvents', limit: 500 }, null);
    return (result.events as any[]).filter((event) => !type || event.type === type);
  }
  publishCommand(
    operationId: string,
    revision: string,
    extra: Record<string, unknown> = {},
    repo = 'app',
  ) {
    return {
      action: 'publish' as const,
      taskId: 'change',
      repositoryId: repo,
      operationId,
      expectedRevision: revision,
      commitMessage: 'feat: muda o valor',
      title: 'Muda o valor',
      body: 'Problema: valor antigo.\n\nMudanças: novo valor.',
      ...extra,
    };
  }
  /** Someone else pushes `branch` on the remote, based on `main`. */
  pushElsewhere(branch = 'task/change', file = 'OTHER.md', repo = 'app') {
    const other = mkdtempSync(join(this.root, 'other-'));
    git(this.root, 'clone', '-q', this.remote(repo), other);
    const start = this.remoteSha(branch, repo) ? `origin/${branch}` : 'origin/main';
    git(other, 'checkout', '-q', '-B', branch, start);
    writeFileSync(join(other, file), `external ${Math.random()}\n`);
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', 'external change');
    git(other, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
    return git(other, 'rev-parse', 'HEAD');
  }
  async cleanup() {
    await this.github.close();
    await this.extension.close();
    this.controller.close();
    rmSync(this.root, { recursive: true, force: true });
  }
}
