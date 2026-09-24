/* eslint-disable @typescript-eslint/no-explicit-any -- runner results are JSON */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { EnvironmentController } from '../src/runtime/controller.js';
import { PublicationFixture, git } from './helpers/publication.js';

let fixture: PublicationFixture;
afterEach(async () => {
  await fixture?.cleanup();
});

describe('isolated publication with a local Git layout', () => {
  it('reviews, commits the exact revision, pushes the task branch and opens one draft PR', async () => {
    fixture = await new PublicationFixture().setup();
    fixture.write('src/index.ts', 'export const value = 2;\n');
    fixture.write('src/new.ts', 'export const added = true;\n');
    const revision = await fixture.revision();
    const review = await fixture.call({
      action: 'reviewPublication',
      taskId: 'change',
      repositoryId: 'app',
      expectedRevision: revision,
    });
    expect(review).toMatchObject({
      ok: true,
      verdict: 'ready',
      revision,
      branch: 'task/change',
      blockers: [],
    });
    expect(review.files).toEqual([
      { path: 'src/index.ts', status: 'M' },
      { path: 'src/new.ts', status: 'A' },
    ]);
    const before = git(fixture.worktree(), 'rev-parse', 'HEAD');
    const result = await fixture.call(
      fixture.publishCommand('op-1', revision, {
        checks: [{ kind: 'test', result: 'passed', revision }],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      push: 'created',
      branch: 'task/change',
      commitCreated: true,
    });
    const sha = result.commitSha as string;
    expect(fixture.remoteSha()).toBe(sha);
    expect(`tree:${git(fixture.remote(), 'rev-parse', `${sha}^{tree}`)}`).toBe(revision);
    expect(git(fixture.remote(), 'rev-parse', `${sha}^`)).toBe(before);
    // The task branch advanced by compare-and-swap; files and index are consistent.
    expect(git(fixture.worktree(), 'rev-parse', 'HEAD')).toBe(sha);
    expect(git(fixture.worktree(), 'status', '--porcelain')).toBe('');
    expect(result.pullRequest).toMatchObject({
      ok: true,
      number: 1,
      draft: true,
      state: 'open',
      resolution: 'created',
    });
    expect(fixture.github.pulls).toHaveLength(1);
    expect(fixture.github.pulls[0].body).toContain('test: passed');
    expect(fixture.github.pulls[0].body).toContain('não está validado integralmente');

    // Same operation again: recorded result, no second effect.
    const posts = fixture.github.requests.filter(
      (request) => request.method === 'POST' && request.path.endsWith('/pulls'),
    ).length;
    const replay = await fixture.call(
      fixture.publishCommand('op-1', revision, {
        checks: [{ kind: 'test', result: 'passed', revision }],
      }),
    );
    expect(replay).toMatchObject({ ok: true, replayed: true, commitSha: sha });
    expect(
      fixture.github.requests.filter(
        (request) => request.method === 'POST' && request.path.endsWith('/pulls'),
      ),
    ).toHaveLength(posts);
    const conflict = await fixture.call(
      fixture.publishCommand('op-1', revision, { title: 'Outro título' }),
    );
    expect(conflict).toMatchObject({ ok: false, error: { code: 'idempotency_conflict' } });

    const types = (await fixture.events()).map((event) => event.type);
    for (const type of [
      'operation_intended',
      'publication_reviewed',
      'git_commit_created',
      'git_push_started',
      'git_push_finished',
      'github_token_issued',
      'draft_pull_request_created',
    ])
      expect(types).toContain(type);
    const push = (await fixture.events('git_push_finished'))[0];
    expect(push).toMatchObject({
      schemaVersion: 1,
      producer: 'runner',
      botId: 'coder',
      projectId: 'shop',
      taskId: 'change',
      operationId: 'op-1',
      status: 'succeeded',
      payload: { repositoryId: 'app', branch: 'task/change', sha, result: 'created' },
    });
    expect(push.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('never runs hooks, credential helpers, insteadOf rewrites or fsmonitor planted in the clone', async () => {
    fixture = await new PublicationFixture().setup();
    const markers = join(fixture.root, 'markers');
    mkdirSync(markers);
    const evil = join(fixture.root, 'evil.sh');
    writeFileSync(evil, `#!/bin/sh\ntouch ${markers}/$(basename "$0")-$$\n`);
    chmodSync(evil, 0o755);
    const hooks = join(fixture.root, 'evil-hooks');
    mkdirSync(hooks);
    for (const hook of [
      'pre-push',
      'pre-commit',
      'commit-msg',
      'post-commit',
      'reference-transaction',
      'post-checkout',
      'pre-receive',
      'update',
      'post-update',
    ]) {
      writeFileSync(join(hooks, hook), `#!/bin/sh\ntouch ${markers}/hook-${hook}\n`);
      chmodSync(join(hooks, hook), 0o755);
    }
    const clone = fixture.clone();
    git(clone, 'config', 'core.hooksPath', hooks);
    git(clone, 'config', 'credential.helper', `!sh -c 'touch ${markers}/credential-helper'`);
    git(clone, 'config', `url.file:///nonexistent/.insteadOf`, 'file://');
    git(clone, 'config', `url.https://evil.example/.insteadOf`, 'https://github.com/');
    git(clone, 'config', 'core.fsmonitor', evil);
    git(clone, 'config', 'uploadpack.packObjectsHook', evil);
    git(clone, 'config', 'core.alternateRefsCommand', evil);
    // Also a hook in the clone's own hooks directory.
    mkdirSync(join(clone, '.git/hooks'), { recursive: true });
    writeFileSync(
      join(clone, '.git/hooks/pre-push'),
      `#!/bin/sh\ntouch ${markers}/local-pre-push\n`,
    );
    chmodSync(join(clone, '.git/hooks/pre-push'), 0o755);
    fixture.write('src/index.ts', 'export const value = 3;\n');
    const revision = await fixture.revision();
    const result = await fixture.call(fixture.publishCommand('op-evil', revision));
    expect(result).toMatchObject({ ok: true, push: 'created' });
    expect(fixture.remoteSha()).toBe(result.commitSha);
    expect(readdirSync(markers)).toEqual([]);
    // The mirror is runner-owned and carries none of the planted configuration.
    const mirrorConfig = readFileSync(
      join(fixture.root, '.harness/publication/shop/app.git/config'),
      'utf8',
    );
    expect(mirrorConfig).not.toMatch(/hooksPath|credential|insteadOf|fsmonitor|packObjectsHook/);
    expect(existsSync(join(fixture.root, '.harness/publication/shop/app.git/hooks'))).toBe(false);
  });

  it('refuses a revision that changed after review and leaves the branch and the remote untouched', async () => {
    fixture = await new PublicationFixture().setup();
    fixture.write('src/index.ts', 'export const value = 4;\n');
    const reviewed = await fixture.revision();
    expect(
      (
        await fixture.call({
          action: 'reviewPublication',
          taskId: 'change',
          repositoryId: 'app',
          expectedRevision: reviewed,
        })
      ).verdict,
    ).toBe('ready');
    fixture.write('src/index.ts', 'export const value = 5; // edited after review\n');
    const head = git(fixture.worktree(), 'rev-parse', 'HEAD');
    const result = await fixture.call(fixture.publishCommand('op-stale', reviewed));
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'revision_changed', retryable: false },
    });
    expect(result.error.details.currentRevision).toBe(await fixture.revision());
    expect(git(fixture.worktree(), 'rev-parse', 'HEAD')).toBe(head);
    expect(fixture.remoteSha()).toBeUndefined();
    expect(
      (await fixture.events('publication_blocked')).map((event) => event.payload.code),
    ).toContain('revision_changed');
    // The new content needs a new review and a new operation.
    const fresh = await fixture.call(fixture.publishCommand('op-fresh', await fixture.revision()));
    expect(fresh).toMatchObject({ ok: true, push: 'created' });
  });

  it('reports a diverged remote as remote_conflict without reset or force push', async () => {
    fixture = await new PublicationFixture().setup();
    const external = fixture.pushElsewhere();
    fixture.write('src/index.ts', 'export const value = 6;\n');
    const revision = await fixture.revision();
    const review = await fixture.call({
      action: 'reviewPublication',
      taskId: 'change',
      repositoryId: 'app',
      expectedRevision: revision,
    });
    expect(review).toMatchObject({ verdict: 'blocked', fastForward: false });
    expect(review.blockers.map((blocker: any) => blocker.code)).toEqual(['remote_conflict']);
    const head = git(fixture.worktree(), 'rev-parse', 'HEAD');
    const result = await fixture.call(fixture.publishCommand('op-conflict', revision));
    expect(result).toMatchObject({ ok: false, error: { code: 'remote_conflict' } });
    expect(fixture.remoteSha()).toBe(external);
    expect(git(fixture.worktree(), 'rev-parse', 'HEAD')).toBe(head);
    expect(git(fixture.worktree(), 'status', '--porcelain')).toContain('src/index.ts');
  });

  it('detects a remote that moves between review and push and never overwrites it', async () => {
    let external: string | undefined;
    fixture = new PublicationFixture(['app'], {
      hooks: {
        phase: (phase) => {
          if (phase === 'advanced' && !external) external = fixture.pushElsewhere();
        },
      },
    });
    await fixture.setup();
    fixture.write('src/index.ts', 'export const value = 7;\n');
    const result = await fixture.call(fixture.publishCommand('op-race', await fixture.revision()));
    expect(result).toMatchObject({ ok: false, error: { code: 'remote_conflict' } });
    expect(fixture.remoteSha()).toBe(external);
    const finished = await fixture.events('git_push_finished');
    expect(finished.at(-1)).toMatchObject({
      status: 'failed',
      payload: { result: 'rejected_non_fast_forward' },
    });
  });

  it('reconciles a timeout before the push and after the push without a second push or PR', async () => {
    const failures = new Set(['advanced', 'pushed']);
    fixture = new PublicationFixture(['app'], {
      hooks: {
        phase: (phase) => {
          if (failures.delete(phase)) throw new Error(`simulated timeout at ${phase}`);
        },
      },
    });
    await fixture.setup();
    fixture.write('src/index.ts', 'export const value = 8;\n');
    const revision = await fixture.revision();
    // Timeout before the push: nothing reached GitHub; the retry pushes the same commit.
    const first = await fixture.call(fixture.publishCommand('op-timeout', revision));
    expect(first).toMatchObject({ ok: false, error: { retryable: true } });
    expect(fixture.remoteSha()).toBeUndefined();
    const sha = git(fixture.worktree(), 'rev-parse', 'HEAD');
    // Timeout after the push: the outcome is uncertain until reconciled.
    const second = await fixture.call(fixture.publishCommand('op-timeout', revision));
    expect(second).toMatchObject({
      ok: false,
      error: { code: 'operation_uncertain', retryable: true },
    });
    expect(fixture.remoteSha()).toBe(sha);
    const third = await fixture.call(fixture.publishCommand('op-timeout', revision));
    expect(third).toMatchObject({
      ok: true,
      commitSha: sha,
      commitCreated: true,
      reconciled: true,
    });
    expect(fixture.github.pulls).toHaveLength(1);
    expect(git(fixture.remote(), 'rev-list', '--count', 'task/change', '^main')).toBe('1');
    const types = (await fixture.events()).map((event) => event.type);
    expect(types).toContain('operation_uncertain');
    expect(types).toContain('operation_reconciled');
  });

  it('recovers after a runner crash between push and receipt', async () => {
    let hang = true;
    fixture = new PublicationFixture(['app'], {
      hooks: {
        phase: async (phase) => {
          if (phase === 'pushed' && hang) await new Promise(() => undefined);
        },
      },
    });
    await fixture.setup();
    fixture.write('src/index.ts', 'export const value = 9;\n');
    const revision = await fixture.revision();
    void fixture.call(fixture.publishCommand('op-crash', revision));
    for (let i = 0; i < 100 && !fixture.remoteSha(); i++) await delay(50);
    const pushed = fixture.remoteSha();
    expect(pushed).toBeDefined();
    hang = false;
    // "Restart": a new controller and extension on the same root.
    const controller = new EnvironmentController(fixture.root);
    const extension = fixture.newExtension();
    try {
      await extension.recover(controller.context());
      const reconcile = await fixture.call(
        { action: 'reconcilePublication', taskId: 'change', repositoryId: 'app' },
        'coder',
        extension,
        controller,
      );
      expect(reconcile).toMatchObject({
        ok: true,
        state: 'synced',
        remote: { exists: true, sha: pushed },
        pullRequest: null,
      });
      expect(
        reconcile.receipts.find((receipt: any) => receipt.operationId === 'op-crash'),
      ).toMatchObject({ state: 'running', phase: 'pushed' });
      const retry = await fixture.call(
        fixture.publishCommand('op-crash', revision),
        'coder',
        extension,
        controller,
      );
      expect(retry).toMatchObject({
        ok: true,
        commitSha: pushed,
        pullRequest: { resolution: 'created', draft: true },
      });
      expect(fixture.github.pulls).toHaveLength(1);
    } finally {
      await extension.close();
      controller.close();
    }
  });

  it('keeps one draft PR per task: updates the open one, blocks on closed, reconciles a lost create', async () => {
    fixture = await new PublicationFixture().setup();
    fixture.write('src/index.ts', 'export const value = 10;\n');
    const published = await fixture.call(fixture.publishCommand('op-pr', await fixture.revision()));
    expect(published.pullRequest).toMatchObject({ number: 1, resolution: 'created' });
    const update = await fixture.call({
      action: 'ensureDraftPullRequest',
      taskId: 'change',
      repositoryId: 'app',
      operationId: 'pr-2',
      title: 'Novo título',
      body: 'Corpo novo',
    });
    expect(update).toMatchObject({
      ok: true,
      number: 1,
      resolution: 'updated',
      draft: true,
      state: 'open',
    });
    const patch = fixture.github.requests.filter((request) => request.method === 'PATCH').at(-1)!;
    expect(Object.keys(patch.body).sort()).toEqual(['body', 'title']);
    expect(fixture.github.pulls).toHaveLength(1);
    fixture.github.pulls[0].state = 'closed';
    const closed = await fixture.call({
      action: 'ensureDraftPullRequest',
      taskId: 'change',
      repositoryId: 'app',
      operationId: 'pr-3',
      title: 'x',
      body: 'y',
    });
    expect(closed).toMatchObject({
      ok: false,
      error: { code: 'pr_closed', details: { number: 1, merged: false } },
    });
    expect(fixture.github.pulls).toHaveLength(1);
    const decided = await fixture.call({
      action: 'ensureDraftPullRequest',
      taskId: 'change',
      repositoryId: 'app',
      operationId: 'pr-4',
      title: 'x',
      body: 'y',
      replaceClosed: 1,
    });
    expect(decided).toMatchObject({ ok: true, number: 2, resolution: 'created', draft: true });
    // Lost response: GitHub created the PR but the answer never arrived.
    fixture.github.pulls.forEach((pr) => (pr.state = 'closed'));
    fixture.github.fault({ method: 'POST', path: /\/pulls$/, kind: 'delay_after', delayMs: 3_000 });
    const lost = await fixture.call({
      action: 'ensureDraftPullRequest',
      taskId: 'change',
      repositoryId: 'app',
      operationId: 'pr-5',
      title: 'x',
      body: 'y',
      replaceClosed: 2,
    });
    expect(lost).toMatchObject({ ok: true, number: 3, resolution: 'reconciled' });
    expect(fixture.github.pulls.filter((pr) => pr.state === 'open')).toHaveLength(1);
    // Dropped before GitHub saw it: lookup finds nothing, then one create.
    fixture.github.pulls.forEach((pr) => (pr.state = 'closed'));
    fixture.github.fault({ method: 'POST', path: /\/pulls$/, kind: 'drop' });
    const dropped = await fixture.call({
      action: 'ensureDraftPullRequest',
      taskId: 'change',
      repositoryId: 'app',
      operationId: 'pr-6',
      title: 'x',
      body: 'y',
      replaceClosed: 3,
    });
    expect(dropped).toMatchObject({ ok: true, number: 4, resolution: 'created' });
    expect(fixture.github.pulls.filter((pr) => pr.state === 'open')).toHaveLength(1);
    expect(fixture.github.pulls.every((pr) => pr.draft)).toBe(true);
    const types = (await fixture.events()).map((event) => event.type);
    for (const type of [
      'draft_pull_request_created',
      'draft_pull_request_updated',
      'pull_request_reconciled',
      'publication_blocked',
    ])
      expect(types).toContain(type);
  });

  it('refuses a PR before the branch exists remotely', async () => {
    fixture = await new PublicationFixture().setup();
    const result = await fixture.call({
      action: 'ensureDraftPullRequest',
      taskId: 'change',
      repositoryId: 'app',
      operationId: 'pr-early',
      title: 'x',
      body: 'y',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'branch_not_published' } });
    expect(fixture.github.pulls).toHaveLength(0);
  });

  it('publishes one draft PR per repository and links them', async () => {
    fixture = await new PublicationFixture(['app', 'api']).setup();
    fixture.write('src/index.ts', 'export const value = 11;\n', 'app');
    fixture.write('src/index.ts', 'export const value = 12;\n', 'api');
    const app = await fixture.call(
      fixture.publishCommand('multi-app', await fixture.revision('app'), {}, 'app'),
    );
    const api = await fixture.call(
      fixture.publishCommand('multi-api', await fixture.revision('api'), {}, 'api'),
    );
    expect(app.pullRequest).toMatchObject({ owner: 'acme', name: 'app', related: [] });
    expect(api.pullRequest.related).toEqual([
      {
        repositoryId: 'app',
        owner: 'acme',
        name: 'app',
        number: app.pullRequest.number,
        url: app.pullRequest.url,
      },
    ]);
    expect(fixture.github.pullsFor('acme', 'api')[0].body).toContain(
      `acme/app#${app.pullRequest.number}`,
    );
    const relink = await fixture.call({
      action: 'ensureDraftPullRequest',
      taskId: 'change',
      repositoryId: 'app',
      operationId: 'relink',
      title: 'Muda o valor',
      body: 'Corpo',
    });
    expect(relink).toMatchObject({ resolution: 'updated', related: [{ repositoryId: 'api' }] });
    expect(fixture.github.pullsFor('acme', 'app')[0].body).toContain(
      `acme/api#${api.pullRequest.number}`,
    );
    expect(fixture.github.pullsFor('acme', 'app')).toHaveLength(1);
    const reconcile = await fixture.call({
      action: 'reconcilePublication',
      taskId: 'change',
      repositoryId: 'api',
    });
    expect(reconcile.related.map((item: any) => item.repositoryId).sort()).toEqual(['api', 'app']);
  });

  it('blocks secrets anywhere in the pushed history, in file names or PR text, listing paths only', async () => {
    fixture = await new PublicationFixture().setup();
    const token = `ghp_${'A1b2C3d4'.repeat(5)}`;
    fixture.write('config/settings.ts', `export const token = '${token}';\n`);
    // Committed by the agent, then removed: still in the pushed history.
    git(fixture.worktree(), 'add', '-A');
    git(fixture.worktree(), 'commit', '-q', '-m', 'add settings (key AKIAABCDEFGHIJKLMNOP)');
    const agentCommit = git(fixture.worktree(), 'rev-parse', 'HEAD');
    fixture.write('config/settings.ts', 'export const token = process.env.TOKEN;\n');
    fixture.write('.env.production', 'DATABASE_PASSWORD=s3cr3t-value-123\n');
    fixture.write('.env.example', 'DATABASE_PASSWORD=changeme\n');
    // Flagged by its name alone.
    fixture.write('deploy/id_ed25519', 'harmless placeholder content\n');
    const revision = await fixture.revision();
    const review = await fixture.call({
      action: 'reviewPublication',
      taskId: 'change',
      repositoryId: 'app',
      expectedRevision: revision,
    });
    expect(review.verdict).toBe('blocked');
    const secret = review.blockers.find((blocker: any) => blocker.code === 'secret_detected');
    expect(secret.details.paths.sort()).toEqual([
      '.env.production',
      `commit:${agentCommit.slice(0, 12)}`,
      'config/settings.ts',
      'deploy/id_ed25519',
    ]);
    expect(
      secret.details.findings.find((finding: any) => finding.path === 'deploy/id_ed25519').rules,
    ).toEqual(['ssh_private_key']);
    expect(JSON.stringify(review)).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(JSON.stringify(review)).not.toContain(token);
    expect(JSON.stringify(review)).not.toContain('s3cr3t-value-123');
    const head = git(fixture.worktree(), 'rev-parse', 'HEAD');
    const result = await fixture.call(fixture.publishCommand('op-secret', revision));
    expect(result).toMatchObject({ ok: false, error: { code: 'secret_detected' } });
    expect(git(fixture.worktree(), 'rev-parse', 'HEAD')).toBe(head);
    expect(fixture.remoteSha()).toBeUndefined();
    const body = await fixture.call(
      fixture.publishCommand('op-body', revision, { body: `token: ${token}` }),
    );
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'secret_detected', details: { paths: ['pull_request.body'] } },
    });
    expect(JSON.stringify(await fixture.events())).not.toContain(token);
  });

  it('refuses local checks from another revision', async () => {
    fixture = await new PublicationFixture().setup();
    const old = await fixture.revision();
    fixture.write('src/index.ts', 'export const value = 13;\n');
    const revision = await fixture.revision();
    const result = await fixture.call(
      fixture.publishCommand('op-checks', revision, {
        checks: [{ kind: 'test', result: 'passed', revision: old }],
      }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'checks_stale' } });
    expect(fixture.remoteSha()).toBeUndefined();
  });
});
