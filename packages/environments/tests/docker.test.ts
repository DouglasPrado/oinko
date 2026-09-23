import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ProjectSchema, TaskSchema, WorktreeManager } from '@oinko/workspaces';
import { EnvironmentSchema } from '../src/contracts/index.js';
import { DockerSandbox } from '../src/sandbox/docker.js';
import { runCommand } from '../src/runtime/command.js';
import { EnvironmentStore } from '../src/storage/store.js';
import { PreviewManager } from '../src/runtime/previews.js';
import { probeRoute } from '../src/routing/probe.js';
import { startEnvironmentService } from '../src/runtime/service.js';

it.skipIf(process.env.OINKO_DOCKER_TEST !== '1')(
  'creates real worktrees and executes code in a project container without changing the source checkout',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'oinko-docker-'));
    const source = join(root, 'source');
    mkdirSync(source);
    writeFileSync(join(source, 'hello.txt'), 'original');
    await runCommand('git', ['init', '-b', 'main', source]);
    await runCommand('git', ['-C', source, 'add', '.']);
    await runCommand('git', [
      '-C',
      source,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@localhost',
      'commit',
      '-m',
      'fixture',
    ]);
    await runCommand('git', [
      '-C',
      source,
      'remote',
      'add',
      'origin',
      'https://user:host-token@example.com/private.git',
    ]);
    const environment = EnvironmentSchema.parse({ id: 'node', name: 'Node' });
    const project = ProjectSchema.parse({
      id: 'shop',
      name: 'Shop',
      environmentId: 'node',
      repositories: [{ id: 'app', source }],
    });
    const sandbox = new DockerSandbox(root, () => environment);
    try {
      await sandbox.ensure(project);
      await new WorktreeManager(sandbox).create(
        project,
        TaskSchema.parse({
          id: 'change',
          projectId: 'shop',
          name: 'Change',
          branch: 'task/change',
        }),
      );
      const result = await sandbox.shell(
        project,
        'change',
        'app',
        "printf 'changed' > hello.txt; git status --porcelain; test ! -S /var/run/docker.sock; test ! -e /workspace/../../Users",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hello.txt');
      expect(
        await sandbox.git(project, ['remote', '-v'], '/workspace/tasks/change/app'),
      ).not.toContain('host-token');
      expect(
        (
          await sandbox.shell(
            project,
            'change',
            'app',
            'git add hello.txt && git commit -m changed',
          )
        ).exitCode,
      ).toBe(0);
      expect(readFileSync(join(source, 'hello.txt'), 'utf8')).toBe('original');
      expect(
        (
          await sandbox.git(project, ['branch', '--show-current'], '/workspace/tasks/change/app')
        ).trim(),
      ).toBe('task/change');
      await sandbox.stop(project.id);
      await sandbox.ensure(project);
      expect((await sandbox.shell(project, 'change', 'app', 'cat hello.txt')).stdout).toBe(
        'changed',
      );
    } finally {
      await sandbox.stop(project.id);
      rmSync(root, { recursive: true, force: true });
    }
  },
  600_000,
);

it.skipIf(process.env.OINKO_DOCKER_TEST !== '1')(
  'imports Compose with a completed dependency, updates mounted code and recovers the runner with honest build failures',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'oinko-compose-runtime-'));
    const source = join(root, 'source');
    mkdirSync(source);
    writeFileSync(join(source, 'message.txt'), 'before-edit');
    writeFileSync(
      join(source, 'server.cjs'),
      "console.log(process.env.TOKEN);require('node:http').createServer((req,res)=>res.end(require('node:fs').readFileSync('message.txt'))).listen(3000,'0.0.0.0')",
    );
    writeFileSync(
      join(source, 'compose.yaml'),
      `services:
  prepare:
    image: node:22-alpine
    command: [node, -e, 'process.exit(0)']
  web:
    image: node:22-alpine
    command: [node, server.cjs]
    depends_on:
      prepare:
        condition: service_completed_successfully
    environment:
      TOKEN: \${TOKEN}
`,
    );
    await runCommand('git', ['init', '-b', 'main', source]);
    await runCommand('git', ['-C', source, 'add', '.']);
    await runCommand('git', [
      '-C',
      source,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@localhost',
      'commit',
      '-m',
      'fixture',
    ]);
    let service = await startEnvironmentService(root);
    const { sandbox } = service.controller;
    try {
      service.controller.environments.saveSettings({ port: 3191 }, 0);
      const environment = service.controller.environments.saveEnvironment(
        {
          id: 'node',
          name: 'Node',
          compose: { repositoryId: 'app', path: 'compose.yaml' },
          services: [
            {
              id: 'web',
              repositoryId: 'app',
              mode: 'development',
              expose: true,
              secrets: ['TOKEN'],
            },
          ],
        },
        { TOKEN: 'secret-compose-runtime' },
        0,
      );
      const project = service.controller.workspaces.saveProject(
        {
          id: 'project',
          name: 'Project',
          environmentId: 'node',
          repositories: [{ id: 'app', source }],
          allowedBotIds: [],
        },
        0,
      );
      await service.controller.handle({
        command: {
          action: 'createTask',
          definition: {
            id: 'change',
            projectId: project.id,
            name: 'Change',
            branch: 'task/change',
          },
        },
      });
      await service.controller.drain();
      await service.controller.handle({ command: { action: 'startPreview', taskId: 'change' } });
      await service.controller.drain();
      const preview = service.controller.environments.preview('change');
      expect(preview.state, preview.error).toBe('ready');
      const host = new URL(preview.urls[0]!.url).hostname;
      expect((await probeRoute(3191, host)).body).toBe('before-edit');
      await sandbox.shell(project, 'change', 'app', "printf 'after-edit' > message.txt");
      expect((await probeRoute(3191, host)).body).toBe('after-edit');
      const logs = await service.controller.previews.logs('change');
      expect(logs).toContain('[redacted]');
      expect(logs).not.toContain('secret-compose-runtime');
      await service.close();
      service = await startEnvironmentService(root);
      expect(service.controller.environments.preview('change').state).toBe('ready');
      expect((await probeRoute(3191, host)).body).toBe('after-edit');
      service.controller.environments.saveEnvironment(
        {
          ...environment,
          compose: undefined,
          services: [{ id: 'web', builder: 'dockerfile', repositoryId: 'app', expose: true }],
        },
        {},
        environment.revision,
      );
      writeFileSync(
        join(sandbox.path('project'), 'tasks/change/app/Dockerfile'),
        'FROM node:22-alpine\nRUN echo secret-compose-runtime && exit 42\n',
      );
      await service.controller.handle({ command: { action: 'startPreview', taskId: 'change' } });
      await service.controller.drain();
      const failed = service.controller.environments
        .jobs()
        .find((job) => job.type === 'startPreview' && job.state === 'failed');
      expect(failed).toBeDefined();
      expect(
        JSON.stringify(await service.controller.handle({ command: { action: 'state' } })),
      ).not.toContain('secret-compose-runtime');
      expect(service.controller.environments.preview('change').state).toBe('failed');
      await service.close();
      service = await startEnvironmentService(root);
      expect(service.controller.environments.preview('change').state).toBe('failed');
    } finally {
      for (const preview of service.controller.environments.previews())
        await service.controller.previews.stop(preview.id).catch(() => {});
      await runCommand('docker', ['rm', '-f', service.controller.previews.router.name], {
        allowFailure: true,
      });
      await sandbox.stop('project');
      await service.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
  180_000,
);

it.skipIf(process.env.OINKO_DOCKER_TEST !== '1')(
  'serves two worktrees through real Compose and Traefik, preserves data, and recovers after manager restart',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'oinko-previews-'));
    const source = join(root, 'source');
    mkdirSync(source);
    writeFileSync(
      join(source, 'server.cjs'),
      "const http=require('node:http'),fs=require('node:fs');http.createServer((req,res)=>res.end(fs.readFileSync('message.txt'))).listen(3000,'0.0.0.0')",
    );
    writeFileSync(join(source, 'message.txt'), 'first-worktree');
    writeFileSync(
      join(source, 'Dockerfile'),
      'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node", "server.cjs"]\n',
    );
    await runCommand('git', ['init', '-b', 'main', source]);
    await runCommand('git', ['-C', source, 'add', '.']);
    await runCommand('git', [
      '-C',
      source,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@localhost',
      'commit',
      '-m',
      'fixture',
    ]);
    const store = new EnvironmentStore(root);
    store.saveSettings({ port: 3189 }, 0);
    const environment = store.saveEnvironment(
      {
        id: 'node',
        name: 'Node',
        maxPreviews: 2,
        services: [
          {
            id: 'web',
            builder: 'dockerfile',
            repositoryId: 'app',
            port: 3000,
            expose: true,
            secrets: ['TEST_PRIVATE'],
          },
          {
            id: 'redis',
            image: 'redis:8-alpine',
            volumes: [{ name: 'redis-data', target: '/data' }],
          },
        ],
      },
      { TEST_PRIVATE: 'this-must-stay-encrypted' },
      0,
    );
    const project = ProjectSchema.parse({
      id: 'shop',
      name: 'Shop',
      environmentId: environment.id,
      repositories: [{ id: 'app', source }],
    });
    const sandbox = new DockerSandbox(root, (id) => store.environment(id));
    const manager = new PreviewManager(root, store, sandbox);
    const first = TaskSchema.parse({
      id: 'first',
      projectId: 'shop',
      name: 'First',
      branch: 'task/first',
      state: 'ready',
    });
    const second = TaskSchema.parse({
      id: 'second',
      projectId: 'shop',
      name: 'Second',
      branch: 'task/second',
      state: 'ready',
    });
    async function readPreview(url: string) {
      const target = new URL(url);
      return (await probeRoute(3189, target.hostname)).body;
    }
    try {
      await sandbox.ensure(project);
      const worktrees = new WorktreeManager(sandbox);
      await worktrees.create(project, first);
      await worktrees.create(project, second);
      await sandbox.shell(project, second.id, 'app', "printf 'second-worktree' > message.txt");
      const previewA = await manager.start(project, first);
      const previewB = await manager.start(project, second);
      expect(await readPreview(previewA.urls[0]!.url)).toBe('first-worktree');
      expect(await readPreview(previewB.urls[0]!.url)).toBe('second-worktree');
      expect(readFileSync(store.runtime(first.id)!.path, 'utf8')).not.toContain(
        'this-must-stay-encrypted',
      );
      const redis = `${store.runtime(first.id)!.name}-redis`;
      await runCommand('docker', ['exec', redis, 'redis-cli', 'SET', 'kept', 'yes']);
      await runCommand('docker', ['exec', redis, 'redis-cli', 'SAVE']);
      await manager.stop(first.id);
      expect(await readPreview(previewB.urls[0]!.url)).toBe('second-worktree');
      await manager.start(project, first);
      expect(
        (await runCommand('docker', ['exec', redis, 'redis-cli', 'GET', 'kept'])).stdout.trim(),
      ).toBe('yes');
      await new PreviewManager(root, store, sandbox).reconcile();
      expect(store.preview(first.id).state).toBe('ready');
      expect(store.preview(second.id).state).toBe('ready');
      store.saveEnvironment({ ...environment, maxPreviews: 1 }, {}, environment.revision);
      const reviewEnvironment = store.saveEnvironment(
        { ...environment, id: 'review', name: 'Review', maxPreviews: 1 },
        { TEST_PRIVATE: 'this-must-stay-encrypted' },
        0,
      );
      project.environmentIds = [reviewEnvironment.id];
      const review = await manager.start(project, first, undefined, 'review');
      expect(await readPreview(review.urls[0]!.url)).toBe('first-worktree');
      const stableA = await manager.start(project, first);
      const stableB = await manager.start(project, second);
      expect(stableA.urls).toEqual(stableB.urls);
      expect(store.preview(first.id).state).toBe('stopped');
      expect(await readPreview(stableB.urls[0]!.url)).toBe('second-worktree');
      expect(store.preview(review.id).state).toBe('ready');
      expect(await readPreview(review.urls[0]!.url)).toBe('first-worktree');
      expect(review.urls).not.toEqual(stableB.urls);
    } catch (error) {
      const proxyLogs = await runCommand('docker', ['logs', manager.router.name], {
        allowFailure: true,
      });
      process.stderr.write(proxyLogs.stdout + proxyLogs.stderr);
      for (const preview of store.previews()) process.stderr.write(await manager.logs(preview.id));
      throw error;
    } finally {
      for (const preview of store.previews()) {
        await manager.stop(preview.id).catch(() => {});
        const prepared = store.runtime(preview.id);
        if (prepared)
          await runCommand(
            'docker',
            ['compose', '-p', prepared.name, '-f', prepared.path, 'down', '-v'],
            { env: prepared.runtimeEnv, allowFailure: true },
          );
      }
      await runCommand('docker', ['rm', '-f', manager.router.name], { allowFailure: true });
      await sandbox.stop(project.id);
      const images = (
        await runCommand('docker', [
          'image',
          'ls',
          '--format',
          '{{.Repository}}:{{.Tag}}',
          '--filter',
          `reference=${sandbox.namespace}-*`,
        ])
      ).stdout
        .trim()
        .split('\n')
        .filter(Boolean);
      for (const image of images) await runCommand('docker', ['image', 'rm', image]);
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
  600_000,
);
