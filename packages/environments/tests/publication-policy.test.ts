import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeChecks, overall } from '../src/publication/checks.js';
import { Redactor, lineRules, pathRules, scanPatch, scanText } from '../src/publication/secrets.js';
import { PublicationFixture, git } from './helpers/publication.js';

describe('secret scan', () => {
  const patch = [
    'commit 0123456789abcdef',
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1,4 @@',
    `-const old = 'ghp_${'x'.repeat(36)}';`,
    '+const key = `-----BEGIN RSA PRIVATE KEY-----`;',
    '+const aws = "AKIAABCDEFGHIJKLMNOP";',
    '+const fine = process.env.TOKEN;',
    'diff --git a/.env b/.env',
    '+++ b/.env',
    '+API_TOKEN=abcd1234efgh5678',
    '+PASSWORD=changeme',
    'diff --git a/"odd name.txt" b/"odd name.txt"',
    '+++ "b/odd name.txt"',
    '+see https://deploy:hunter2secret@example.com/repo.git',
    'diff --git a/gone.ts b/gone.ts',
    '+++ /dev/null',
    '+sk-this-line-is-not-in-a-file-anymore-aaaa',
  ].join('\n');
  it('flags added lines only, by rule, and never returns the value', () => {
    const findings = scanPatch(patch);
    expect(findings).toEqual([
      { path: 'src/a.ts', rules: ['aws_access_key', 'private_key'] },
      { path: '.env', rules: ['env_assignment'] },
      { path: 'odd name.txt', rules: ['url_credentials'] },
    ]);
    expect(JSON.stringify(findings)).not.toMatch(/AKIA|abcd1234|hunter2/);
  });
  it('recognizes common tokens and ignores placeholders and references', () => {
    for (const line of [
      `token = "ghs_${'a'.repeat(36)}"`,
      `github_pat_${'b'.repeat(60)}`,
      `OPENAI_API_KEY=sk-proj-${'c'.repeat(30)}`,
      `xoxb-${'1'.repeat(12)}-abcdef`,
      `//registry.npmjs.org/:_authToken=npm_${'d'.repeat(36)}`,
      `jwt: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.${'e'.repeat(20)}`,
      `export STRIPE_SECRET_KEY=sk_live_${'f'.repeat(24)}`,
    ])
      expect(lineRules(line).length, line).toBeGreaterThan(0);
    for (const line of [
      'DATABASE_PASSWORD=changeme',
      'API_TOKEN=${API_TOKEN}',
      'SECRET_KEY=<your-secret>',
      'const token = process.env.GITHUB_TOKEN;',
      'https://user:password@example.com',
      'password: string;',
    ])
      expect(lineRules(line), line).toEqual([]);
    expect(lineRules('value = runner-known-secret-1', ['runner-known-secret-1'])).toEqual([
      'known_secret',
    ]);
  });
  it('flags sensitive file names but not examples', () => {
    expect(pathRules('.env')).toEqual(['env_file']);
    expect(pathRules('apps/web/.env.local')).toEqual(['env_file']);
    expect(pathRules('.env.example')).toEqual([]);
    expect(pathRules('deploy/id_ed25519')).toEqual(['ssh_private_key']);
    expect(pathRules('certs/client.p12')).toEqual(['keystore']);
    expect(pathRules('src/environment.ts')).toEqual([]);
    expect(scanText('pull_request.body', 'ok\n-----BEGIN OPENSSH PRIVATE KEY-----\nabc')).toEqual([
      { path: 'pull_request.body', rules: ['private_key'] },
    ]);
  });
  it('redacts known values, their Basic header form and credential shapes', () => {
    const redactor = new Redactor();
    const token = `ghs_${'Z'.repeat(36)}`;
    redactor.add(token);
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    const text = redactor.text(
      `a ${token} b ${basic} c AUTHORIZATION: basic ${basic} -----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----`,
    );
    expect(text).not.toContain(token);
    expect(text).not.toContain(basic);
    expect(text).not.toContain('MIIE');
    expect(redactor.deep({ list: [token], nested: { value: token } })).toEqual({
      list: ['[redacted]'],
      nested: { value: '[redacted]' },
    });
  });
});

describe('CI normalization', () => {
  const sha = 'a'.repeat(40);
  const run = (
    name: string,
    status: string,
    conclusion: string | null,
    extra: Record<string, unknown> = {},
  ) => ({
    id: extra.id ?? 1,
    name,
    head_sha: sha,
    status,
    conclusion,
    html_url: `https://github.test/checks/${name}`,
    ...extra,
  });
  it('maps check runs and statuses to one state vocabulary', () => {
    const result = normalizeChecks(
      sha,
      [
        run('queued', 'queued', null),
        run('running', 'in_progress', null),
        run('ok', 'completed', 'success'),
        run('bad', 'completed', 'timed_out'),
        run('stop', 'completed', 'cancelled'),
        run('skip', 'completed', 'skipped'),
      ],
      [
        { context: 'ci/status', state: 'pending' },
        { context: 'ci/error', state: 'error' },
      ],
      [],
    );
    const states = Object.fromEntries(result.checks.map((check) => [check.name, check.state]));
    expect(states).toEqual({
      queued: 'queued',
      running: 'running',
      ok: 'passed',
      bad: 'failed',
      stop: 'cancelled',
      skip: 'passed',
      'ci/status': 'running',
      'ci/error': 'failed',
    });
    expect(result.checks.find((check) => check.name === 'skip')!.skipped).toBe(true);
    expect(result.state).toBe('failed');
  });
  it('never infers success from absence, skipped-only or another commit', () => {
    expect(normalizeChecks(sha, [], [], 'unknown')).toMatchObject({
      state: 'unknown',
      reason: 'none',
      checks: [],
    });
    expect(normalizeChecks(sha, [run('skip', 'completed', 'skipped')], [], []).state).toBe(
      'unknown',
    );
    const other = normalizeChecks(
      sha,
      [run('ok', 'completed', 'success', { head_sha: 'b'.repeat(40) })],
      [],
      [],
    );
    expect(other).toMatchObject({ state: 'unknown', reason: 'none', checks: [] });
  });
  it('uses the newest re-run and waits for missing required checks', () => {
    const rerun = normalizeChecks(
      sha,
      [
        run('test', 'completed', 'failure', { id: 1 }),
        run('test', 'completed', 'success', { id: 2 }),
      ],
      [],
      ['test', 'build'],
    );
    expect(rerun).toMatchObject({
      state: 'queued',
      reason: 'required_missing',
      missingRequired: ['build'],
    });
    expect(rerun.checks[0]).toMatchObject({ name: 'test', state: 'passed', required: true });
    expect(
      normalizeChecks(sha, [run('test', 'completed', 'success')], [], 'unknown').checks[0]!
        .required,
    ).toBe('unknown');
    expect(overall([])).toEqual({ state: 'unknown', reason: 'none' });
  });
});

describe('publication authorization', () => {
  let fixture: PublicationFixture | undefined;
  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });
  const location = { taskId: 'change', repositoryId: 'app' };

  it('requires an allowed publisher bot for every publication command; admin only reads status and installation', async () => {
    fixture = await new PublicationFixture().setup();
    fixture.write('src/index.ts', 'export const value = 2;\n');
    const revision = await fixture.revision();
    const commands = [
      { action: 'reviewPublication', ...location, expectedRevision: revision },
      fixture.publishCommand('op-auth', revision),
      {
        action: 'ensureDraftPullRequest',
        ...location,
        operationId: 'pr-auth',
        title: 'x',
        body: 'y',
      },
      { action: 'reconcilePublication', ...location },
      { action: 'inspectChecks', ...location, sha: 'a'.repeat(40) },
    ] as const;
    for (const command of commands) {
      // Allowed in the project, but not a publisher.
      expect((await fixture.call(command, 'reader')).error?.code, command.action).toBe(
        'publisher_required',
      );
      // Not allowed in the project: same answer as an unknown task.
      const intruder = await fixture.call(command, 'intruder');
      const ghost = await fixture.call({ ...command, taskId: 'ghost' }, 'intruder');
      expect(intruder.error).toEqual(ghost.error);
      expect(intruder.error.code).toBe('not_found');
      expect((await fixture.call(command, null)).error?.code, `admin ${command.action}`).toBe(
        'publisher_required',
      );
    }
    expect(
      (await fixture.call({ action: 'githubInstallation', projectId: 'shop' }, 'reader')).error
        .code,
    ).toBe('publisher_required');
    expect(
      (await fixture.call({ action: 'githubInstallation', projectId: 'shop' }, 'intruder')).error
        .code,
    ).toBe('not_found');
    expect(
      (await fixture.call({ action: 'githubInstallation', projectId: 'shop' }, null)).status,
    ).toBe('ready');
    expect(fixture.remoteSha()).toBeUndefined();
    expect(fixture.github.pulls).toHaveLength(0);
  });

  it('works for any configured publisher and applies revocation on the next call and before the push', async () => {
    let revoke = false;
    fixture = new PublicationFixture(['app'], {
      hooks: {
        phase: (phase) => {
          if (phase === 'reviewed' && revoke) {
            const project = fixture!.controller.workspaces.project('shop');
            fixture!.controller.workspaces.saveProject(
              { ...project, programming: { ...project.programming!, publisherBotIds: [] } },
              project.revision,
            );
          }
        },
      },
    });
    await fixture.setup();
    // No bot name is special: a new ID becomes publisher by configuration only.
    const project = fixture.controller.workspaces.project('shop');
    fixture.controller.workspaces.saveProject(
      {
        ...project,
        allowedBotIds: [...project.allowedBotIds, 'zeta-42'],
        programming: { ...project.programming!, publisherBotIds: ['zeta-42'] },
      },
      project.revision,
    );
    fixture.write('src/index.ts', 'export const value = 2;\n');
    expect(
      await fixture.call(fixture.publishCommand('zeta-1', await fixture.revision()), 'zeta-42'),
    ).toMatchObject({ ok: true, push: 'created' });
    expect(
      (await fixture.call(fixture.publishCommand('coder-1', await fixture.revision()), 'coder'))
        .error.code,
    ).toBe('publisher_required');
    // Revoked between review and push: nothing moves.
    revoke = true;
    fixture.write('src/index.ts', 'export const value = 3;\n');
    const before = fixture.remoteSha();
    const head = git(fixture.worktree(), 'rev-parse', 'HEAD');
    const revoked = await fixture.call(
      fixture.publishCommand('zeta-2', await fixture.revision()),
      'zeta-42',
    );
    expect(revoked).toMatchObject({ ok: false, error: { code: 'publisher_required' } });
    expect(fixture.remoteSha()).toBe(before);
    expect(git(fixture.worktree(), 'rev-parse', 'HEAD')).toBe(head);
  });

  it('only publishes repositories explicitly linked to GitHub', async () => {
    fixture = await new PublicationFixture(['app', 'docs']).setup();
    const project = fixture.controller.workspaces.project('shop');
    fixture.controller.workspaces.saveProject(
      {
        ...project,
        programming: {
          ...project.programming!,
          github: {
            ...project.programming!.github,
            repositories: project.programming!.github.repositories.filter(
              (repo) => repo.repositoryId === 'app',
            ),
          },
        },
      },
      project.revision,
    );
    fixture.write('README.md', '# docs changed\n', 'docs');
    const result = await fixture.call(
      fixture.publishCommand('op-docs', await fixture.revision('docs'), {}, 'docs'),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'repository_not_linked' } });
    expect(fixture.remoteSha('task/change', 'docs')).toBeUndefined();
  });

  it('has no condition on pilot bot names or IDs in the publication code', () => {
    const directory = join(__dirname, '../src/publication');
    for (const file of readdirSync(directory)) {
      const source = readFileSync(join(directory, file), 'utf8');
      expect(source, file).not.toMatch(/botId\s*===?\s*['"]|['"](?:dev|coder|pilot)['"]/);
    }
  });
});
