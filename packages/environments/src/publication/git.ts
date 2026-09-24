import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Id } from '@oinko/workspaces';
import type { CommandRunner } from '../contracts/index.js';
import { runCommand } from '../runtime/command.js';
import { PublicationError } from './errors.js';

/** Where the host mirror may read from or push to, and how it authenticates. */
export interface GitEndpoint {
  url: string;
  protocol: 'https' | 'file' | 'ext';
  /** `http.<origin>.extraHeader` value; provided only through the environment. */
  header?: { origin: string; value: string };
}

export function remoteEndpoint(
  gitUrl: string,
  owner: string,
  name: string,
  token?: string,
): GitEndpoint {
  const url = `${gitUrl}/${owner}/${name}.git`;
  if (url.startsWith('file:')) return { url, protocol: 'file' };
  if (!token) throw new PublicationError('github_unauthorized', 'Token de instalação ausente.');
  return {
    url,
    protocol: 'https',
    header: {
      origin: `${new URL(gitUrl).origin}/`,
      value: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
    },
  };
}

/**
 * Configuration applied to every host Git process. Nothing comes from the
 * system, the user's global config, the user's HOME (.netrc, credentials) or
 * any repository written by the sandbox: hooks, fsmonitor, credential
 * helpers, `url.*.insteadOf`, submodules, redirects and every transport not
 * explicitly allowed for this call are disabled.
 */
function hardening(protocols: GitEndpoint['protocol'][]) {
  const config = [
    'core.hooksPath=/dev/null',
    'core.fsmonitor=false',
    'core.askPass=',
    'credential.helper=',
    'protocol.allow=never',
    ...protocols.map((protocol) => `protocol.${protocol}.allow=always`),
    'http.followRedirects=false',
    'submodule.recurse=false',
    'fetch.recurseSubmodules=false',
    'push.recurseSubmodules=no',
    'gc.auto=0',
    'maintenance.auto=false',
    'core.quotePath=false',
    'fetch.fsckObjects=true',
    'fetch.fsck.zeroPaddedFilemode=ignore',
    'fetch.fsck.badTimezone=ignore',
    'fetch.fsck.missingSpaceBeforeDate=ignore',
  ];
  return config.flatMap((entry) => ['-c', entry]);
}

export interface PushOutcome {
  status: 'created' | 'fast_forward' | 'up_to_date' | 'rejected_non_fast_forward' | 'rejected';
  reason?: string;
}

/**
 * Runner-owned bare mirror `.harness/publication/<project>/<repo>.git`. It is
 * never mounted into a container, so code running in the sandbox can neither
 * read the token used here nor plant configuration or hooks in it.
 */
export class Mirror {
  readonly path: string;
  private readonly home: string;
  constructor(
    readonly root: string,
    projectId: string,
    repositoryId: string,
    private readonly run: CommandRunner = runCommand,
  ) {
    this.path = join(
      root,
      '.harness/publication',
      Id.parse(projectId),
      `${Id.parse(repositoryId)}.git`,
    );
    this.home = join(root, '.harness/publication/.home');
  }
  private env(endpoint?: GitEndpoint) {
    const env: Record<string, string> = {
      HOME: this.home,
      XDG_CONFIG_HOME: this.home,
      LANG: 'C',
      LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
      GIT_PROTOCOL_FROM_USER: '0',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_CONFIG_COUNT: '0',
    };
    if (endpoint?.header) {
      env.GIT_CONFIG_COUNT = '1';
      env.GIT_CONFIG_KEY_0 = `http.${endpoint.header.origin}.extraHeader`;
      env.GIT_CONFIG_VALUE_0 = endpoint.header.value;
    }
    return env;
  }
  async git(
    args: string[],
    options: { endpoint?: GitEndpoint; timeoutMs?: number; allowFailure?: boolean } = {},
  ) {
    const protocols = options.endpoint ? [options.endpoint.protocol] : [];
    const result = await this.run(
      'git',
      ['--git-dir', this.path, ...hardening(protocols), ...args],
      {
        cwd: this.path,
        env: this.env(options.endpoint),
        timeoutMs: options.timeoutMs ?? 120_000,
        allowFailure: options.allowFailure,
      },
    );
    // Captured output is capped in memory: never decide on a truncated listing.
    if (result.stdout.length >= 1_000_000)
      throw new PublicationError(
        'review_too_large',
        'A saída do Git excedeu o limite da revisão automática.',
      );
    return result;
  }
  async ensure() {
    mkdirSync(this.home, { recursive: true, mode: 0o700 });
    if (existsSync(join(this.path, 'HEAD'))) return;
    mkdirSync(this.path, { recursive: true, mode: 0o700 });
    // No template: a fresh bare repository without sample hooks or info files.
    await this.run('git', ['init', '--quiet', '--bare', '--template=', this.path], {
      env: this.env(),
      timeoutMs: 30_000,
    });
  }
  /** Fetches one ref from the sandbox clone into a runner-owned ref of the mirror. */
  async fetch(source: GitEndpoint, from: string, to: string) {
    await this.git(
      [
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-write-fetch-head',
        '--no-recurse-submodules',
        source.url,
        `+${from}:${to}`,
      ],
      { endpoint: source, timeoutMs: 600_000 },
    );
  }
  async lsRemote(remote: GitEndpoint, branches: string[]) {
    const result = await this.git(
      ['ls-remote', '--refs', remote.url, ...branches.map((branch) => `refs/heads/${branch}`)],
      { endpoint: remote, timeoutMs: 60_000, allowFailure: true },
    );
    if (result.exitCode !== 0) throw remoteFailure(result.stderr);
    const refs = new Map<string, string>();
    for (const line of result.stdout.split('\n')) {
      const [sha, ref] = line.trim().split('\t');
      if (sha && ref?.startsWith('refs/heads/')) refs.set(ref.slice('refs/heads/'.length), sha);
    }
    return new Map(branches.map((branch) => [branch, refs.get(branch)]));
  }
  async fetchRemote(remote: GitEndpoint, branch: string, to: string) {
    const result = await this.git(
      [
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-write-fetch-head',
        '--no-recurse-submodules',
        remote.url,
        `+refs/heads/${branch}:${to}`,
      ],
      { endpoint: remote, timeoutMs: 600_000, allowFailure: true },
    );
    if (result.exitCode !== 0) throw remoteFailure(result.stderr);
  }
  async revParse(rev: string) {
    const result = await this.git(['rev-parse', '--verify', '--quiet', rev], {
      allowFailure: true,
    });
    return result.exitCode === 0 ? result.stdout.trim() : undefined;
  }
  async hasCommit(sha: string) {
    const result = await this.git(['cat-file', '-e', `${sha}^{commit}`], { allowFailure: true });
    return result.exitCode === 0;
  }
  async isAncestor(ancestor: string, descendant: string) {
    const result = await this.git(['merge-base', '--is-ancestor', ancestor, descendant], {
      allowFailure: true,
    });
    return result.exitCode === 0;
  }
  async mergeBase(a: string, b: string) {
    const result = await this.git(['merge-base', a, b], { allowFailure: true });
    return result.exitCode === 0 ? result.stdout.trim() : undefined;
  }
  async revList(tip: string, exclude: string[]) {
    const result = await this.git(['rev-list', tip, ...exclude.map((sha) => `^${sha}`)]);
    return result.stdout.split('\n').filter(Boolean);
  }
  /** Net change set between `base` and `tip` (what the PR shows). */
  async files(base: string, tip: string) {
    const result = await this.git(['diff', '--no-renames', '--name-status', '-z', base, tip]);
    const parts = result.stdout.split('\0').filter(Boolean);
    const files: { path: string; status: string }[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2)
      files.push({ status: parts[i]!, path: parts[i + 1]! });
    return files;
  }
  /** Every path added or modified by any commit being pushed. */
  async touched(tip: string, exclude: string[]) {
    const result = await this.git([
      'log',
      '--no-renames',
      '--name-status',
      '-z',
      '--format=',
      tip,
      ...exclude.map((sha) => `^${sha}`),
    ]);
    const parts = result.stdout
      .split('\0')
      .map((part) => part.replace(/^\n+/, ''))
      .filter(Boolean);
    const paths = new Set<string>();
    for (let i = 0; i + 1 < parts.length; i += 2)
      if (/^[AMT]/.test(parts[i]!)) paths.add(parts[i + 1]!);
    return [...paths];
  }
  /**
   * Full patch and messages of the pushed commits, written to a runner-owned
   * file (command output is capped in memory). No external diff drivers or
   * textconv filters run.
   */
  async history(tip: string, exclude: string[], maxBytes: number) {
    const directory = mkdtempSync(join(this.root, '.harness/publication/.review-'));
    const output = join(directory, 'history.patch');
    try {
      await this.git(
        [
          'log',
          '-p',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '--no-renames',
          '--format=commit %H%n%B',
          `--output=${output}`,
          tip,
          ...exclude.map((sha) => `^${sha}`),
        ],
        { timeoutMs: 300_000 },
      );
      if (statSync(output).size > maxBytes)
        throw new PublicationError(
          'review_too_large',
          'O histórico a publicar é grande demais para a revisão automática de segredos.',
          { details: { maxBytes } },
        );
      return readFileSync(output, 'utf8');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  async messages(tip: string, exclude: string[]) {
    const result = await this.git([
      'log',
      '--format=%H%x1f%B%x1e',
      tip,
      ...exclude.map((sha) => `^${sha}`),
    ]);
    return result.stdout
      .split('\x1e')
      .map((entry) => entry.replace(/^\n+/, ''))
      .filter(Boolean)
      .map((entry) => {
        const [sha, message] = entry.split('\x1f');
        return { sha: sha!, message: message ?? '' };
      });
  }
  async commitTree(sha: string) {
    return (await this.git(['rev-parse', '--verify', `${sha}^{tree}`])).stdout.trim();
  }
  /** Plain push of one commit to one branch: no `+`, no `--force`, no hooks. */
  async push(remote: GitEndpoint, sha: string, branch: string): Promise<PushOutcome> {
    const result = await this.git(
      [
        'push',
        '--porcelain',
        '--no-verify',
        '--no-recurse-submodules',
        remote.url,
        `${sha}:refs/heads/${branch}`,
      ],
      { endpoint: remote, timeoutMs: 600_000, allowFailure: true },
    );
    const line = result.stdout
      .split('\n')
      .find((entry) => entry.includes(`:refs/heads/${branch}\t`));
    if (line) {
      const flag = line[0];
      const summary = line.split('\t')[2] ?? '';
      if (flag === '=') return { status: 'up_to_date' };
      if (flag === '*') return { status: 'created' };
      if (flag === ' ') return { status: 'fast_forward' };
      if (flag === '!')
        return /non-fast-forward|fetch first|stale info/.test(summary) &&
          !/remote rejected/.test(summary)
          ? { status: 'rejected_non_fast_forward', reason: summary }
          : { status: 'rejected', reason: summary };
    }
    if (result.exitCode === 0) return { status: 'fast_forward' };
    throw remoteFailure(result.stderr);
  }
}

function remoteFailure(stderr: string) {
  if (/\b403\b|Permission to .* denied|denied to/i.test(stderr))
    return new PublicationError(
      'permission_denied',
      'O GitHub negou o acesso Git ao repositório.',
      {
        status: 403,
      },
    );
  if (/\b401\b|Authentication failed|could not read Username/i.test(stderr))
    return new PublicationError('github_unauthorized', 'Credencial Git recusada pelo GitHub.', {
      status: 401,
      retryable: true,
    });
  if (/Repository not found|does not appear to be a git repository|\b404\b/i.test(stderr))
    return new PublicationError(
      'repository_not_accessible',
      'Repositório remoto não encontrado ou inacessível.',
      {
        status: 404,
      },
    );
  return new PublicationError(
    'git_failed',
    `Git falhou ao contatar o remoto: ${stderr.trim().slice(-500)}`,
    {
      retryable: true,
    },
  );
}
