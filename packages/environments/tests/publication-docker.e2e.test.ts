/* eslint-disable @typescript-eslint/no-explicit-any -- runner results are JSON */
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/runtime/command.js';
import { FULL_PERMISSIONS, FakeGithub, git } from './helpers/publication.js';
import { RuntimeFixture } from './helpers/runtime.js';

function files(directory: string, out: string[] = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (stat?.isDirectory()) files(path, out);
    else if (stat?.isFile()) out.push(path);
  }
  return out;
}

describe.skipIf(process.env.OINKO_DOCKER_TEST !== '1')(
  'publication through the runner process and a real Docker sandbox',
  () => {
    let f: RuntimeFixture;
    let github: FakeGithub;
    beforeEach(async () => {
      f = new RuntimeFixture();
      github = await new FakeGithub().start();
      await f.start();
    });
    afterEach(async () => {
      await github.close();
      await f.cleanup();
    }, 120_000);

    it('publishes a sandbox worktree through the host mirror while code in the sandbox never sees the token', async () => {
      await f.configure();
      const remotes = join(f.root, 'remotes');
      mkdirSync(join(remotes, 'acme'), { recursive: true });
      git(f.root, 'clone', '-q', '--bare', f.source, join(remotes, 'acme/app.git'));
      const project = (await f.client.state()).projects.find((item) => item.id === 'project')!;
      const { revision: projectRevision, ...definition } = project;
      await f.client.command({
        action: 'saveProject',
        definition: {
          ...definition,
          programming: {
            github: {
              installationId: 42,
              repositories: [
                { repositoryId: 'app', owner: 'acme', name: 'app', baseBranch: 'main' },
              ],
            },
            publisherBotIds: ['coder'],
          },
        },
        revision: projectRevision,
      });
      github.installations.set(42, {
        account: 'acme',
        permissions: { ...FULL_PERMISSIONS },
        repositories: ['acme/app'],
      });
      const saved = await f.client.command<any>({
        action: 'saveGithubApp',
        appId: github.appId,
        privateKeyPem: github.key.pem,
        apiUrl: github.url,
        gitUrl: `file://${remotes}`,
      });
      expect(saved).toMatchObject({ ok: true, configured: true });
      await f.task();

      // Hostile repository configuration planted from inside the sandbox.
      const planted = await f.shell(
        [
          'set -e',
          'mkdir -p /workspace/evil',
          `printf '#!/bin/sh\\ntouch /workspace/marker-$(basename "$0")\\n' > /workspace/evil/hook`,
          'chmod +x /workspace/evil/hook',
          'for h in pre-push pre-commit reference-transaction post-checkout; do cp /workspace/evil/hook /workspace/evil/$h; done',
          'git -C /workspace/repositories/app config core.hooksPath /workspace/evil',
          `git -C /workspace/repositories/app config credential.helper '!touch /workspace/marker-credential'`,
          'git -C /workspace/repositories/app config core.fsmonitor /workspace/evil/hook',
          'git -C /workspace/repositories/app config url.file:///nonexistent/.insteadOf file://',
        ].join('\n'),
      );
      expect(planted.exitCode).toBe(0);
      await f.write('packages/shared/message.txt', 'published from the sandbox');
      const before = await f.coder.command<any>({
        action: 'reconcilePublication',
        taskId: 'change',
        repositoryId: 'app',
      });
      expect(before).toMatchObject({
        ok: true,
        state: 'unpublished',
        local: { available: true, branchRef: 'refs/heads/task/change' },
      });
      const revision = before.local.revision as string;

      // Code in the sandbox looks for credentials while the publication runs.
      let probeFinished = 0;
      const probe = f
        .shell(
          'for i in $(seq 1 40); do env; cat /proc/*/environ 2>/dev/null | tr "\\000" "\\n"; git config -l 2>/dev/null; git -C /workspace/repositories/app config -l; ls -la /workspace; sleep 0.1; done',
        )
        .then((output) => {
          probeFinished = Date.now();
          return output;
        });
      const result = await f.coder.command<any>({
        action: 'publish',
        taskId: 'change',
        repositoryId: 'app',
        operationId: 'docker-1',
        expectedRevision: revision,
        commitMessage: 'feat: publica a partir do sandbox',
        title: 'Publica a partir do sandbox',
        body: 'Mudança feita no sandbox Docker.',
      });
      const publishFinished = Date.now();
      const probed = await probe;
      // The probe started first and was still running when the publication ended.
      expect(probeFinished).toBeGreaterThanOrEqual(publishFinished);
      // No hook, helper or fsmonitor ran during the publication (checked before any other Git call).
      const markers = await f.shell('ls /workspace | grep marker || true');
      expect(markers.stdout.trim()).toBe('');
      expect(result).toMatchObject({
        ok: true,
        push: 'created',
        commitCreated: true,
        pullRequest: { ok: true, draft: true, resolution: 'created' },
      });
      expect(git(join(remotes, 'acme/app.git'), 'rev-parse', 'refs/heads/task/change')).toBe(
        result.commitSha,
      );
      expect(
        `tree:${git(join(remotes, 'acme/app.git'), 'rev-parse', `${result.commitSha}^{tree}`)}`,
      ).toBe(revision);
      expect(github.pulls).toHaveLength(1);
      // The sandbox branch moved to the published commit; the worktree is clean.
      const status = await f.shell(
        'git -c core.fsmonitor=false -c core.hooksPath=/dev/null rev-parse HEAD && git -c core.fsmonitor=false -c core.hooksPath=/dev/null status --porcelain',
      );
      expect(status.stdout.trim()).toBe(result.commitSha);

      const tokens = github.issued;
      expect(tokens.length).toBeGreaterThan(0);
      const credentials = [
        ...tokens,
        ...tokens.map((token) => Buffer.from(`x-access-token:${token}`).toString('base64')),
        ...github.key.pem
          .split('\n')
          .filter((line) => line.length > 20 && !line.startsWith('-----')),
      ];
      const seen = probed.stdout + probed.stderr;
      expect(seen.length).toBeGreaterThan(1000);
      for (const credential of credentials) expect(seen.includes(credential)).toBe(false);
      expect(seen).not.toMatch(/x-access-token|extraheader/i);
      // Nothing under the runner root holds a credential: workspace, mirror, DBs, logs.
      for (const file of files(f.root)) {
        const content = readFileSync(file);
        for (const credential of credentials)
          expect(content.includes(Buffer.from(credential)), `${file} contains a credential`).toBe(
            false,
          );
      }
      // The publication mirror is outside the mounted workspace.
      const inspect = await runCommand('docker', [
        'inspect',
        '--format',
        '{{range .Mounts}}{{.Source}} {{end}}',
        `${f.namespace}-work-project`,
      ]);
      expect(inspect.stdout).toContain('.harness/workspaces/project');
      expect(inspect.stdout).not.toContain('.harness/publication');
      const events = await f.client.command<any>({
        action: 'publicationEvents',
        projectId: 'project',
        limit: 500,
      });
      expect(events.events.map((event: any) => event.type)).toEqual(
        expect.arrayContaining([
          'publication_reviewed',
          'git_commit_created',
          'git_push_started',
          'git_push_finished',
          'draft_pull_request_created',
        ]),
      );
    }, 600_000);
  },
);
