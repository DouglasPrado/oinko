/* eslint-disable @typescript-eslint/no-explicit-any -- runner results are JSON */
import { afterEach, describe, expect, it } from 'vitest';
import { PublicationFixture } from './helpers/publication.js';

let fixture: PublicationFixture | undefined;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

const run = (sha: string, name: string, status: string, conclusion: string | null, id = 1) => ({
  id,
  name,
  head_sha: sha,
  status,
  conclusion,
  html_url: `https://github.test/acme/app/runs/${id}`,
  app: { slug: 'github-actions' },
});

async function published(value: number, operationId: string) {
  fixture!.write('src/index.ts', `export const value = ${value};\n`);
  const result = await fixture!.call(
    fixture!.publishCommand(operationId, await fixture!.revision()),
  );
  expect(result.ok).toBe(true);
  return result.commitSha as string;
}
const inspect = (sha: string, extension = fixture!.extension) =>
  fixture!.call(
    { action: 'inspectChecks', taskId: 'change', repositoryId: 'app', sha },
    'coder',
    extension,
  );

describe('CI polling for the exact published SHA', () => {
  it('never attributes an older commit result to the current head', async () => {
    fixture = await new PublicationFixture().setup();
    const first = await published(2, 'ci-1');
    fixture.github.checkRuns.set(first, [
      run(first, 'test', 'completed', 'success', 1),
      run(first, 'lint', 'completed', 'success', 2),
    ]);
    const passed = await inspect(first);
    expect(passed).toMatchObject({
      ok: true,
      sha: first,
      headSha: first,
      current: true,
      state: 'passed',
      required: [],
      fullyValidated: true,
    });
    expect(passed.checks.map((check: any) => [check.name, check.state, check.url])).toEqual([
      ['lint', 'passed', 'https://github.test/acme/app/runs/2'],
      ['test', 'passed', 'https://github.test/acme/app/runs/1'],
    ]);
    // A new commit while polling: the old green result stays with the old SHA.
    const second = await published(3, 'ci-2');
    const stale = await inspect(first);
    expect(stale).toMatchObject({
      current: false,
      supersededBy: second,
      state: 'passed',
      fullyValidated: false,
    });
    // GitHub listing a run for another SHA under this commit is ignored.
    fixture.github.checkRuns.set(second, [run(first, 'test', 'completed', 'success', 3)]);
    const none = await inspect(second);
    expect(none).toMatchObject({
      current: true,
      state: 'unknown',
      reason: 'none',
      checks: [],
      fullyValidated: false,
    });
    fixture.github.checkRuns.set(second, [run(second, 'test', 'in_progress', null, 4)]);
    expect(await inspect(second)).toMatchObject({ state: 'running', fullyValidated: false });
    fixture.github.checkRuns.set(second, [run(second, 'test', 'completed', 'cancelled', 5)]);
    expect(await inspect(second)).toMatchObject({ state: 'cancelled' });
    fixture.github.statuses.set(second, [
      { context: 'ci/legacy', state: 'failure', target_url: 'https://ci.test/1' },
    ]);
    expect(await inspect(second)).toMatchObject({ state: 'failed' });
    const events = await fixture.events();
    expect(
      events
        .filter((event) => event.type === 'ci_poll_finished')
        .map((event) => [event.payload.sha, event.payload.overall]),
    ).toEqual([
      [first, 'passed'],
      [first, 'passed'],
      [second, 'unknown'],
      [second, 'running'],
      [second, 'cancelled'],
      [second, 'failed'],
    ]);
    // One update per state change of a check, keyed by SHA.
    expect(
      events
        .filter((event) => event.type === 'ci_check_updated' && event.payload.sha === second)
        .map((event) => [event.payload.check, event.payload.status]),
    ).toEqual([
      ['test', 'running'],
      ['test', 'cancelled'],
      ['ci/legacy', 'failed'],
    ]);
  });

  it('reports required checks when readable, unknown otherwise, and waits for missing ones', async () => {
    fixture = await new PublicationFixture().setup();
    const sha = await published(2, 'ci-req');
    fixture.github.branch = {
      protected: true,
      protection: {
        enabled: true,
        required_status_checks: { contexts: ['build'], checks: [{ context: 'test' }] },
      },
    };
    fixture.github.checkRuns.set(sha, [run(sha, 'test', 'completed', 'success')]);
    const missing = await inspect(sha);
    expect(missing).toMatchObject({
      state: 'queued',
      reason: 'required_missing',
      required: ['build', 'test'],
      missingRequired: ['build'],
    });
    expect(missing.checks[0]).toMatchObject({ name: 'test', required: true });
    fixture.github.branch = 'forbidden';
    fixture.github.rules = 'forbidden';
    const unknown = await inspect(sha);
    expect(unknown).toMatchObject({ state: 'passed', required: 'unknown' });
    expect(unknown.checks[0].required).toBe('unknown');
  });

  it('turns rate limits and a revoked installation into explicit, resumable states', async () => {
    fixture = await new PublicationFixture().setup();
    const sha = await published(2, 'ci-limits');
    fixture.github.fault({
      method: 'GET',
      path: /check-runs$/,
      kind: 'status',
      status: 429,
      headers: { 'retry-after': '30' },
    });
    const limited = await inspect(sha);
    expect(limited).toMatchObject({
      ok: true,
      state: 'unknown',
      reason: 'unavailable',
      fullyValidated: false,
      unavailable: { code: 'rate_limited', retryable: true, retryAfterSeconds: 30 },
    });
    const reset = Math.floor(Date.now() / 1000) + 120;
    fixture.github.fault({
      method: 'GET',
      path: /check-runs$/,
      kind: 'status',
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    });
    const primary = await inspect(sha);
    expect(primary.unavailable).toMatchObject({
      code: 'rate_limited',
      retryable: true,
      resetAt: new Date(reset * 1000).toISOString(),
    });
    expect(primary.unavailable.retryAfterSeconds).toBeGreaterThan(100);
    // Resumes normally afterwards.
    expect((await inspect(sha)).state).toBe('unknown');
    expect((await inspect(sha)).unavailable).toBeUndefined();
    fixture.github.installations.delete(42);
    const fresh = fixture.newExtension();
    try {
      const revoked = await inspect(sha, fresh);
      expect(revoked).toMatchObject({
        state: 'unknown',
        unavailable: { code: 'installation_not_found', retryable: false },
      });
    } finally {
      await fresh.close();
    }
    const unavailable = (await fixture.events('ci_status_unavailable')).map(
      (event) => event.payload.code,
    );
    expect(unavailable).toEqual(['rate_limited', 'rate_limited', 'installation_not_found']);
  });
});

describe('credential isolation', () => {
  it('never returns, logs or stores the App key, installation tokens or runner secrets', async () => {
    fixture = await new PublicationFixture().setup();
    const planted = 'PLANTED-runner-secret-7f3a91';
    fixture.controller.environments.saveEnvironment(
      { id: 'node', name: 'Node' },
      { DEPLOY_KEY: planted },
      0,
    );
    // The agent copies a runner secret into the code: blocked, and never echoed.
    fixture.write('src/leak.ts', `export const key = '${planted}';\n`);
    const blocked = await fixture.call({
      action: 'reviewPublication',
      taskId: 'change',
      repositoryId: 'app',
      expectedRevision: await fixture.revision(),
    });
    expect(blocked.blockers[0]).toMatchObject({
      code: 'secret_detected',
      details: { findings: [{ path: 'src/leak.ts', rules: ['known_secret'] }] },
    });
    fixture.write('src/leak.ts', 'export const key = process.env.DEPLOY_KEY;\n');
    const sha = await published(2, 'leak-1');
    await fixture.call({
      action: 'ensureDraftPullRequest',
      taskId: 'change',
      repositoryId: 'app',
      operationId: 'leak-2',
      title: 't',
      body: 'b',
    });
    await fixture.call({ action: 'reconcilePublication', taskId: 'change', repositoryId: 'app' });
    await inspect(sha);
    await fixture.call({ action: 'githubInstallation', projectId: 'shop' }, null);
    await fixture.call({ action: 'githubAppStatus', verify: true }, null);
    fixture.github.fault({ method: 'POST', path: /access_tokens$/, kind: 'status', status: 500 });
    fixture.github.fault({ method: 'GET', path: /\/pulls$/, kind: 'status', status: 500 });
    await fixture.call({
      action: 'ensureDraftPullRequest',
      taskId: 'change',
      repositoryId: 'app',
      operationId: 'leak-3',
      title: 't',
      body: 'b',
    });
    await fixture.events();

    const tokens = fixture.github.issued;
    expect(tokens.length).toBeGreaterThan(0);
    const secrets = [
      ...tokens,
      ...tokens.map((token) => Buffer.from(`x-access-token:${token}`).toString('base64')),
      ...fixture.github.key.pem
        .split('\n')
        .filter((line) => line.length > 20 && !line.startsWith('-----')),
      planted,
    ];
    const outputs = fixture.outputs.join('\n');
    for (const secret of secrets) expect(outputs.includes(secret), 'command results').toBe(false);
    expect(outputs).not.toContain('PRIVATE KEY-----\n');
    // Nothing on disk under the runner root: DB, WAL, key, mirror, workspace, sandbox layout.
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) walk(path);
        else if (stat.isFile()) files.push(path);
      }
    };
    walk(fixture.root);
    expect(files.some((file) => file.endsWith('publication.db'))).toBe(true);
    for (const file of files) {
      const content = readFileSync(file);
      for (const secret of [...tokens, ...secrets.slice(tokens.length * 2, -1)])
        expect(content.includes(Buffer.from(secret)), `${file} contains a credential`).toBe(false);
    }
  });
});
