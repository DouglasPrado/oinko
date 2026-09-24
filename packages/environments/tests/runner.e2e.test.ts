import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvironmentClient, environmentRequest, environmentSocket } from '../src/client/index.js';
import type { Environment, Job, Preview } from '../src/contracts/index.js';
import { runCommand } from '../src/runtime/command.js';
import { probeRoute } from '../src/routing/probe.js';
import { RuntimeFixture, eventually, freePort } from './helpers/runtime.js';

describe.skipIf(process.env.OINKO_DOCKER_TEST !== '1')(
  'runner process → Git/Docker/HTTP E2E',
  () => {
    let f: RuntimeFixture;
    beforeEach(async () => {
      f = new RuntimeFixture();
      await f.start();
    });
    afterEach(async () => {
      await f.cleanup();
    }, 60_000);

    async function environment(patch: Partial<Environment>, secrets: Record<string, string> = {}) {
      const previous = (await f.client.state()).environments.find(
        (e) => e.id === (patch.id ?? 'node'),
      );
      return f.client.command({
        action: 'saveEnvironment',
        definition: { ...previous, id: 'node', name: 'Node', ...patch },
        secrets,
        revision: previous?.revision ?? 0,
      });
    }
    async function preview(taskId = 'change', environmentId?: string) {
      return (await f.job({ action: 'startPreview', taskId, environmentId })).result as Preview;
    }
    async function response(p: Preview) {
      const url = new URL(p.urls[0]!.url);
      return probeRoute(Number(url.port), url.hostname);
    }

    it('persists project-first configuration, validates revisions and authorizes every command over the socket', async () => {
      await f.repository();
      expect(statSync(environmentSocket(f.root)).mode & 0o777).toBe(0o600);
      const definition = {
        id: 'project',
        name: 'Project',
        repositories: [{ id: 'app', source: f.source }],
        allowedBotIds: ['coder'],
      };
      await f.client.command({ action: 'saveProject', definition, revision: 0 });
      const failed = await f.job(
        {
          action: 'createTask',
          definition: { id: 'change', projectId: 'project', name: 'Change', branch: 'task/change' },
        },
        'failed',
      );
      expect(failed.error).toMatch(/primeiro ambiente/);
      await expect(f.read('Dockerfile')).rejects.toThrow(/não está pronta/);
      await environment({}, { TOKEN: 'process-secret-private' });
      const project = { ...definition, environmentId: 'node' };
      await f.client.command({ action: 'saveProject', definition: project, revision: 1 });
      await expect(
        f.client.command({ action: 'saveProject', definition: project, revision: 1 }),
      ).rejects.toThrow(/alterad|revis|conflit/i);
      await f.task(); // failed task can be retried with the same ID and branch
      await expect(f.task()).rejects.toThrow(/já utilizado/);
      await expect(
        f.client.command({
          action: 'saveProject',
          definition: { ...project, repositories: [{ id: 'other', source: f.source }] },
          revision: 2,
        }),
      ).rejects.toThrow(/outro projeto/);
      await environment({ id: 'unrelated', name: 'Private' });
      await expect(
        f.coder.command({ action: 'startPreview', taskId: 'change', environmentId: 'unrelated' }),
      ).rejects.toThrow(/não pertence/);
      const intruder = new EnvironmentClient(f.root, 'intruder');
      for (const command of [
        { action: 'startSandbox', projectId: 'project' },
        { action: 'stopSandbox', projectId: 'project' },
        {
          action: 'createTask',
          definition: { id: 'no', name: 'No', projectId: 'project', branch: 'task/no' },
        },
        { action: 'shell', taskId: 'change', repositoryId: 'app', command: 'pwd' },
        { action: 'readFile', taskId: 'change', repositoryId: 'app', path: 'Dockerfile' },
        { action: 'writeFile', taskId: 'change', repositoryId: 'app', path: 'no', content: 'no' },
        { action: 'startPreview', taskId: 'change' },
        { action: 'jobLogs', jobId: failed.id },
      ] as const)
        await expect(intruder.command(command)).rejects.toThrow(/autorizad/);
      for (const command of [
        { action: 'saveProject', definition: project, revision: 2 },
        { action: 'saveEnvironment', definition: { id: 'node', name: 'Node' }, revision: 1 },
        { action: 'saveSettings', definition: {}, revision: 0 },
      ] as const)
        await expect(f.coder.command(command)).rejects.toThrow(/administrador/);
      const scoped = await f.coder.state();
      expect(scoped.settings).toBeUndefined();
      expect(scoped.environments.map((e) => e.id)).toEqual(['node']);
      expect(JSON.stringify(scoped)).not.toContain('process-secret-private');
      expect((await intruder.state()).projects).toEqual([]);
      await f.stop();
      expect(
        readFileSync(join(f.root, '.harness/environments.db')).includes(
          Buffer.from('process-secret-private'),
        ),
      ).toBe(false);
      expect(statSync(join(f.root, '.harness/environments.key')).mode & 0o777).toBe(0o600);
      await f.start();
      expect((await f.client.state()).tasks[0]?.state).toBe('ready');
      await f.client.command({
        action: 'saveProject',
        definition: { ...project, allowedBotIds: [] },
        revision: 2,
      });
      expect((await f.coder.state()).tasks).toEqual([]);
      await expect(f.read('Dockerfile')).rejects.toThrow(/autorizad/);
    }, 120_000);

    it('isolates multi-repository worktrees, preserves Git edits and reapplies resource/network limits', async () => {
      await f.configure();
      await Promise.all([f.task('change'), f.task('second')]);
      await f.write('nested/unicode.txt', 'Olá 👋\n');
      expect(await f.read('nested/unicode.txt')).toEqual({ text: 'Olá 👋\n' });
      expect(
        (await f.shell('git add . && git commit -m change && git branch --show-current')).stdout,
      ).toContain('task/change');
      expect((await f.shell('git status --porcelain', 'second')).stdout).toBe('');
      expect(
        (
          await f.coder.command<{ stdout: string }>({
            action: 'shell',
            taskId: 'change',
            repositoryId: 'api',
            command: 'git branch --show-current',
          })
        ).stdout.trim(),
      ).toBe('task/change');
      expect(existsSync(join(f.source, 'nested/unicode.txt'))).toBe(false);
      const failed = await f.shell('echo output; echo diagnostic >&2; exit 7');
      expect(failed).toEqual({ stdout: 'output\n', stderr: 'diagnostic\n', exitCode: 7 });
      const timed = await f.coder.command<{ exitCode: number }>({
        action: 'shell',
        taskId: 'change',
        repositoryId: 'app',
        command: 'sleep 10',
        timeoutSeconds: 1,
      });
      expect(timed.exitCode).toBe(124);
      await f.shell("node -e \"require('fs').writeFileSync('large', 'x'.repeat(200001))\"");
      await expect(f.read('large')).rejects.toThrow(/200 KB/);
      await expect(f.read('missing')).rejects.toThrow(/ENOENT/);
      await expect(f.read('../api/Dockerfile')).rejects.toThrow();
      await expect(
        f.coder.command({
          action: 'readFile',
          taskId: 'change',
          repositoryId: 'other',
          path: 'file',
        }),
      ).rejects.toThrow(/não pertence/);
      await f.job({ action: 'stopSandbox', projectId: 'project' });
      expect((await f.client.state()).sandboxes.project).toBe('absent');
      expect((await f.read('nested/unicode.txt')).text).toBe('Olá 👋\n');
      await environment({ cpus: 0.5, memoryMb: 256, network: 'none' });
      await f.job({ action: 'startSandbox', projectId: 'project' });
      const [container] = JSON.parse(
        (await runCommand('docker', ['inspect', `${f.namespace}-work-project`])).stdout,
      );
      expect(container.HostConfig).toMatchObject({
        NetworkMode: 'none',
        NanoCpus: 500_000_000,
        Memory: 268_435_456,
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
      });
      expect(
        container.Mounts.filter((m: { Type: string }) => m.Type === 'bind').map(
          (m: { Destination: string }) => m.Destination,
        ),
      ).toEqual(['/workspace']);
      expect(
        (
          await f.shell(
            'test ! -e /var/run/docker.sock && test ! -e /workspace/.harness/bots.key && test ! -e /Users && test ! -e /workspace/tasks/change/app/.env',
          )
        ).exitCode,
      ).toBe(0);
      expect((await f.read('nested/unicode.txt')).text).toBe('Olá 👋\n');
      await f.job({ action: 'stopSandbox', projectId: 'project' });
      await f.job({ action: 'stopSandbox', projectId: 'project' });
    }, 120_000);

    it('rejects existing and dangling symlink escapes for file writes without creating an outside target', async () => {
      await f.configure();
      await f.task();
      await f.shell(
        'echo outside > /tmp/existing; ln -s /tmp/existing existing; ln -s /tmp/not-created dangling; ln -s /tmp outside; ln -s packages/shared/message.txt inside',
      );
      for (const path of ['existing', 'dangling', 'outside/new']) {
        await expect(f.write(path, 'escaped'), path).rejects.toThrow(/Symlink fora/);
      }
      expect(
        (await f.shell('cat /tmp/existing; test ! -e /tmp/not-created; test ! -e /tmp/new')).stdout,
      ).toBe('outside\n');
      await expect(f.read('existing')).rejects.toThrow(/Symlink fora/);
      await f.write('inside', 'allowed');
      expect((await f.read('packages/shared/message.txt')).text).toBe('allowed');
    }, 90_000);

    it('preserves large UTF-8 contents across HTTP chunks when writing and reading a worktree file', async () => {
      await f.configure();
      await f.task();
      const content = '🐷'.repeat(40_000);
      await f.write('unicode-large.txt', content);
      expect((await f.read('unicode-large.txt')).text === content).toBe(true);
    }, 90_000);

    it('builds a monorepo target, rebuilds image content, hot reloads development and rotates secrets without mixing environments', async () => {
      await f.configure();
      await f.task();
      const port = await freePort();
      await f.client.command({ action: 'saveSettings', definition: { port }, revision: 0 });
      const service = {
        id: 'web',
        repositoryId: 'app',
        builder: 'dockerfile' as const,
        buildTarget: 'web',
        expose: true,
        secrets: ['TOKEN'],
        buildEnvironment: { PUBLIC_VALUE: 'built' },
      };
      await f.client.command({
        action: 'saveEnvironment',
        definition: { id: 'node', name: 'Node', services: [service] },
        secrets: { TOKEN: 'old-runtime-secret' },
        revision: 1,
      });
      const first = await preview();
      expect((await response(first)).body).toBe('original|built');
      await f.write('packages/shared/message.txt', 'edited');
      expect((await response(first)).body).toBe('original|built');
      const rebuilt = await preview();
      expect(rebuilt.urls).toEqual(first.urls);
      expect((await response(rebuilt)).body).toBe('edited|built');
      await environment({}, { TOKEN: 'rotated-runtime-secret' });
      const logs = await f.client.command<{ text: string }>({
        action: 'previewLogs',
        previewId: first.id,
      });
      expect(logs.text).toContain('[redacted]');
      expect(logs.text).not.toContain('old-runtime-secret');
      await preview();
      expect(
        (
          await runCommand('docker', [
            'exec',
            `${f.namespace}-p-${first.id}-web`,
            'node',
            '-p',
            'process.env.TOKEN',
          ])
        ).stdout.trim(),
      ).toBe('rotated-runtime-secret');
      const project = (await f.client.state()).projects[0]!;
      await f.client.command({
        action: 'saveEnvironment',
        definition: {
          id: 'review',
          name: 'Review',
          services: [
            {
              id: 'web',
              repositoryId: 'app',
              mode: 'development',
              command: 'node apps/web/server.cjs',
              expose: true,
            },
          ],
        },
        revision: 0,
      });
      await f.client.command({
        action: 'saveProject',
        definition: { ...project, environmentIds: ['review'] },
        revision: project.revision,
      });
      const review = await preview('change', 'review');
      expect(review.id).not.toBe(first.id);
      await f.write('packages/shared/message.txt', 'hot');
      expect((await response(review)).body).toBe('hot|');
      expect((await response(first)).body).toBe('edited|built');
      const intruder = new EnvironmentClient(f.root, 'intruder');
      await expect(
        intruder.command({ action: 'previewLogs', previewId: review.id }),
      ).rejects.toThrow(/autorizad/);
      await expect(
        intruder.command({ action: 'stopPreview', previewId: review.id }),
      ).rejects.toThrow(/autorizad/);
      await expect(
        f.client.command({
          action: 'saveSettings',
          definition: { port: await freePort() },
          revision: 1,
        }),
      ).rejects.toThrow(/Pare as prévias/);
      await f.stop();
      await f.start();
      expect((await f.client.state()).previews.every((p) => p.state === 'ready')).toBe(true);
      expect((await response(review)).body).toBe('hot|');
      await f.job({ action: 'stopPreview', previewId: first.id });
      await f.job({ action: 'stopPreview', previewId: first.id });
      expect((await response(review)).status).toBe(200);
      const generated = readFileSync(
        join(f.root, '.harness/runtime/previews', first.id, 'compose.json'),
        'utf8',
      );
      expect(generated).not.toContain('old-runtime-secret');
      expect(generated).not.toContain('rotated-runtime-secret');
      await environment({}, { TOKEN: '' });
      expect(
        (await f.client.state()).environments.find((env) => env.id === 'node')?.secretNames,
      ).toEqual([]);
      expect((await f.job({ action: 'startPreview', taskId: 'change' }, 'failed')).error).toMatch(
        /segredo TOKEN/,
      );
      expect((await response(review)).body).toBe('hot|');
    }, 200_000);

    it('serves previews for descriptive task names through real Docker DNS and Traefik', async () => {
      await f.configure();
      await f.client.command({
        action: 'saveSettings',
        definition: { port: await freePort() },
        revision: 0,
      });
      await environment({
        services: [
          {
            id: 'dashboard',
            builder: 'image',
            image: 'node:22-alpine',
            command: `node -e "require('node:http').createServer((req,res)=>res.end('long-name-preview')).listen(3000,'0.0.0.0')"`,
            expose: true,
          },
        ] as Environment['services'],
      });
      const taskId = 'fazer-versao-dark-do-dashboard-b82e12';
      await f.task(taskId);
      const result = await preview(taskId);
      expect(result.state).toBe('ready');
      expect(await response(result)).toEqual({ status: 200, body: 'long-name-preview' });
      await f.stop();
      await f.start();
      expect((await f.client.state()).previews.find((item) => item.id === result.id)?.state).toBe(
        'ready',
      );
      expect((await response(result)).body).toBe('long-name-preview');
      await f.job({ action: 'stopPreview', previewId: result.id });
    }, 120_000);

    it('marks real queued work failed after an abrupt runner death and permits retry', async () => {
      await f.configure();
      await f.task();
      const pending = f.shell('touch marker; sleep 4; touch finished').catch(() => undefined);
      await eventually(
        async () => existsSync(join(f.root, '.harness/workspaces/project/tasks/change/app/marker')),
        Boolean,
      );
      const queued = await f.client.command<Job>({
        action: 'createTask',
        definition: {
          id: 'interrupted',
          projectId: 'project',
          name: 'Interrupted',
          branch: 'task/interrupted',
        },
      });
      expect(queued.state).toBe('queued');
      await f.stop('SIGKILL');
      await pending;
      await f.start();
      const recovered = await f.client.state();
      expect(recovered.jobs.find((j) => j.id === queued.id)?.state).toBe('failed');
      expect(recovered.tasks.find((t) => t.id === 'interrupted')?.state).toBe('failed');
      await f.task('interrupted');
      expect((await f.client.state()).tasks.find((t) => t.id === 'interrupted')?.state).toBe(
        'ready',
      );
    }, 120_000);

    it('reports a real unavailable Docker endpoint without stopping the user daemon, then recovers', async () => {
      await f.configure();
      await f.stop();
      await f.start({ DOCKER_HOST: `unix://${f.root}/missing-docker.sock`, DOCKER_CONTEXT: '' });
      expect((await f.client.state()).sandboxes.project).toBe('unavailable');
      expect(
        (await f.job({ action: 'startSandbox', projectId: 'project' }, 'failed')).error,
      ).toMatch(/docker|daemon|connect/i);
      expect(
        (await f.job({ action: 'stopSandbox', projectId: 'project' }, 'failed')).error,
      ).toMatch(/Docker/);
      await f.stop();
      await f.start();
      await f.task();
      expect((await f.client.state()).sandboxes.project).toBe('running');
    }, 90_000);

    it('honors the configured workspace image and retries after replacing one without Git', async () => {
      await f.configure();
      await environment({ workspaceImage: 'node:22-alpine' });
      const failed = await f.job(
        {
          action: 'createTask',
          definition: { id: 'change', projectId: 'project', name: 'Change', branch: 'task/change' },
        },
        'failed',
      );
      expect(failed.error).toMatch(/git|executable|not found/i);
      const [container] = JSON.parse(
        (await runCommand('docker', ['inspect', `${f.namespace}-work-project`])).stdout,
      );
      expect(container.Config.Image).toBe('node:22-alpine');
      await environment({ workspaceImage: 'oinko-workspace:1' });
      await f.task();
      expect((await f.shell('git branch --show-current')).stdout.trim()).toBe('task/change');
    }, 90_000);

    it('reports an occupied proxy port and recovers after releasing it', async () => {
      await f.configure();
      await f.task();
      const port = await freePort();
      // Docker Desktop can bypass a native host listener; reserve the actual Docker mapping.
      const blocker = `${f.namespace}-port-blocker`;
      await runCommand('docker', [
        'run',
        '-d',
        '--name',
        blocker,
        '-p',
        `127.0.0.1:${port}:3000`,
        'node:22-alpine',
        'sleep',
        'infinity',
      ]);
      try {
        await f.client.command({ action: 'saveSettings', definition: { port }, revision: 0 });
        await f.client.command({
          action: 'saveEnvironment',
          definition: {
            id: 'node',
            name: 'Node',
            services: [
              {
                id: 'web',
                repositoryId: 'app',
                mode: 'development',
                command: 'node apps/web/server.cjs',
                expose: true,
              },
            ],
          },
          revision: 1,
        });
        const failed = await f.job({ action: 'startPreview', taskId: 'change' }, 'failed');
        expect(failed.error).toMatch(/port|bind|address|allocated/i);
        expect((await f.client.state()).previews[0]?.urls).toEqual([]);
      } finally {
        await runCommand('docker', ['rm', '-f', blocker]);
      }
      expect((await response(await preview())).body).toBe('original|');
    }, 120_000);

    it('rejects malformed commands and unknown resources without killing the process', async () => {
      for (const command of [
        { action: 'unknown' },
        { action: 'startSandbox', projectId: '../outside' },
        {
          action: 'createTask',
          definition: {
            id: 'bad',
            name: 'Bad',
            projectId: 'project',
            branch: '--upload-pack=evil',
          },
        },
        { action: 'saveEnvironment', definition: { id: 'bad', name: 'Bad', cpus: 0 }, revision: 0 },
        {
          action: 'saveEnvironment',
          definition: { id: 'bad', name: 'Bad', services: [{ id: 'web', context: '../' }] },
          revision: 0,
        },
        { action: 'stopPreview', previewId: 'missing' },
        { action: 'jobLogs', jobId: 'missing' },
        { action: 'shell', taskId: 'missing', repositoryId: 'app', command: 'pwd' },
      ])
        await expect(environmentRequest(f.root, '/command', { command })).rejects.toThrow();
      expect((await environmentRequest<{ ready: boolean }>(f.root, '/health')).ready).toBe(true);
    });

    it('refreshes HTTPS task bases inside the sandbox and reports a missing Git ref honestly', async () => {
      await f.configure();
      await f.client.command({
        action: 'saveProject',
        definition: {
          id: 'remote',
          name: 'Remote',
          environmentId: 'node',
          allowedBotIds: ['coder'],
          repositories: [{ id: 'app', source: 'https://github.com/octocat/Hello-World.git' }],
        },
        revision: 0,
      });
      await f.task('remote-task', 'remote');
      expect(
        (
          await f.coder.command<{ text: string }>({
            action: 'readFile',
            taskId: 'remote-task',
            repositoryId: 'app',
            path: 'README',
          })
        ).text,
      ).toContain('Hello World');
      const remoteHead = await f.coder.command<{ stdout: string }>({
        action: 'shell',
        taskId: 'remote-task',
        repositoryId: 'app',
        command: 'git rev-parse HEAD',
      });
      const stale = await f.coder.command<{ exitCode: number }>({
        action: 'shell',
        taskId: 'remote-task',
        repositoryId: 'app',
        command:
          'git -C /workspace/repositories/app update-ref refs/heads/stale HEAD~1 && git -C /workspace/repositories/app symbolic-ref HEAD refs/heads/stale',
      });
      expect(stale.exitCode).toBe(0);
      await f.task('remote-next', 'remote');
      const refreshed = await f.coder.command<{ stdout: string }>({
        action: 'shell',
        taskId: 'remote-next',
        repositoryId: 'app',
        command: 'git rev-parse HEAD',
      });
      expect(refreshed.stdout).toBe(remoteHead.stdout);
      await f.client.command({
        action: 'saveProject',
        definition: {
          id: 'bad-ref',
          name: 'Missing ref',
          environmentId: 'node',
          repositories: [{ id: 'app', source: f.source, ref: 'nonexistent-ref' }],
        },
        revision: 0,
      });
      const failed = await f.job(
        {
          action: 'createTask',
          definition: {
            id: 'bad-ref-task',
            projectId: 'bad-ref',
            name: 'Bad ref',
            branch: 'task/bad-ref',
          },
        },
        'failed',
      );
      expect(failed.error).toMatch(/nonexistent-ref/);
      expect((await f.client.state()).tasks.find((task) => task.id === 'bad-ref-task')?.state).toBe(
        'failed',
      );
    }, 120_000);

    it.skipIf(process.env.OINKO_RAILPACK_TEST !== '1')(
      'builds a Railpack subdirectory with custom build/start commands and serves it through Traefik',
      async () => {
        await f.configure();
        await f.task();
        await f.write(
          'apps/standalone/package.json',
          JSON.stringify({
            name: 'railpack-preview-e2e',
            version: '1.0.0',
            engines: { node: '22' },
            scripts: { build: 'exit 17', start: 'exit 17' },
          }),
        );
        await f.write(
          'apps/standalone/build.cjs',
          "require('fs').writeFileSync('built.txt', process.env.PUBLIC_MESSAGE)",
        );
        await f.write(
          'apps/standalone/server.cjs',
          "require('http').createServer((req,res)=>res.end(require('fs').readFileSync('built.txt'))).listen(3000,'0.0.0.0')",
        );
        await f.client.command({
          action: 'saveSettings',
          definition: { port: await freePort() },
          revision: 0,
        });
        await f.client.command({
          action: 'saveEnvironment',
          definition: {
            id: 'node',
            name: 'Node',
            services: [
              {
                id: 'web',
                repositoryId: 'app',
                builder: 'railpack',
                context: 'apps/standalone',
                buildCommand: 'node build.cjs',
                command: 'node server.cjs',
                buildEnvironment: { PUBLIC_MESSAGE: 'railpack-through-runner' },
                expose: true,
              },
            ],
          },
          revision: 1,
        });
        const p = await preview();
        expect((await response(p)).body).toBe('railpack-through-runner');
        await f.job({ action: 'stopPreview', previewId: p.id });
      },
      600_000,
    );
  },
);
