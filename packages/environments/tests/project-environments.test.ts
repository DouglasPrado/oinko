import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { ProjectSchema, TaskSchema } from '@oinko/workspaces';
import { EnvironmentController } from '../src/runtime/controller.js';
import { EnvironmentStore } from '../src/storage/store.js';
import { DockerSandbox } from '../src/sandbox/docker.js';
import { PreviewManager } from '../src/runtime/previews.js';

it('creates a project before configuration, exposes only linked environments and rejects an unrelated preview', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oinko-project-envs-'));
  const controller = new EnvironmentController(root);
  vi.spyOn(controller.sandbox, 'status').mockResolvedValue('absent');
  try {
    const definition = {
      id: 'project',
      name: 'Project',
      repositories: [{ id: 'app', source: 'https://example.com/app.git' }],
      allowedBotIds: ['dev'],
    };
    await controller.handle({ command: { action: 'saveProject', definition, revision: 0 } });
    await expect(
      controller.sandbox.ensure(controller.workspaces.project('project')),
    ).rejects.toThrow(/primeiro ambiente/);
    for (const id of ['dev', 'review', 'unrelated'])
      await controller.handle({
        command: { action: 'saveEnvironment', definition: { id, name: id }, revision: 0 },
      });
    await controller.handle({
      command: {
        action: 'saveProject',
        definition: { ...definition, environmentId: 'dev', environmentIds: ['review'] },
        revision: 1,
      },
    });
    const state = (await controller.handle({ command: { action: 'state' }, botId: 'dev' })) as {
      environments: { id: string }[];
    };
    expect(state.environments.map((e) => e.id).sort()).toEqual(['dev', 'review']);
    controller.workspaces.saveTask(
      { id: 'task', name: 'Task', branch: 'task/one', projectId: 'project', state: 'ready' },
      0,
    );
    await expect(
      controller.handle({
        command: { action: 'startPreview', taskId: 'task', environmentId: 'unrelated' },
        botId: 'dev',
      }),
    ).rejects.toThrow(/não pertence/);
    expect(controller.environments.jobs()).toHaveLength(0);
  } finally {
    controller.workspaces.close();
    controller.environments.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it('keeps preview resources and concurrency independent for the same worktree in two environments', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oinko-preview-envs-'));
  const store = new EnvironmentStore(root);
  const run = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
  const sandbox = new DockerSandbox(root, (id) => store.environment(id), run);
  const manager = new PreviewManager(root, store, sandbox, run);
  vi.spyOn(manager.router, 'publish').mockResolvedValue([]);
  vi.spyOn(manager.router, 'ready').mockResolvedValue(undefined);
  vi.spyOn(manager.router, 'unpublish').mockResolvedValue(undefined);
  const project = ProjectSchema.parse({
    id: 'shop',
    name: 'Shop',
    environmentId: 'dev',
    environmentIds: ['review'],
    repositories: [{ id: 'app', source: 'https://example.com/app.git' }],
  });
  try {
    for (const id of ['dev', 'review'])
      store.saveEnvironment(
        { id, name: id, services: [{ id: 'web', image: 'node:22-alpine' }] },
        {},
        0,
      );
    const task = TaskSchema.parse({
      id: 'one',
      projectId: 'shop',
      name: 'One',
      branch: 'task/one',
      state: 'ready',
    });
    mkdirSync(join(sandbox.path('shop'), 'tasks', 'one', 'app'), { recursive: true });
    const first = await manager.start(project, task);
    const second = await manager.start(project, task, undefined, 'review');
    expect(first.id).not.toBe(second.id);
    expect(store.preview(first.id).state).toBe('ready');
    expect(store.runtime(first.id)?.routeGroup).not.toBe(store.runtime(second.id)?.routeGroup);
    expect(second.environmentId).toBe('review');
    await manager.start(project, task, undefined, 'review');
    expect(store.preview(first.id).state).toBe('ready');
    const changedDefault = { ...project, environmentId: 'review', environmentIds: ['dev'] };
    expect((await manager.start(changedDefault, task)).id).toBe(second.id);
    expect((await manager.start(changedDefault, task, undefined, 'dev')).id).toBe(first.id);
    expect(store.preview(second.id).state).toBe('ready');
    await expect(manager.start(project, task, undefined, 'unrelated')).rejects.toThrow(
      /não pertence/,
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it('deletes a preview for good (route, containers, volumes, built images and record) and keeps the task', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oinko-preview-delete-'));
  const store = new EnvironmentStore(root);
  const run = vi.fn<(command: string, args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>>(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
  const sandbox = new DockerSandbox(root, (id) => store.environment(id), run);
  const manager = new PreviewManager(root, store, sandbox, run);
  vi.spyOn(manager.router, 'publish').mockResolvedValue([]);
  vi.spyOn(manager.router, 'ready').mockResolvedValue(undefined);
  const unpublish = vi.spyOn(manager.router, 'unpublish').mockResolvedValue(undefined);
  const project = ProjectSchema.parse({ id: 'shop', name: 'Shop', environmentId: 'dev', repositories: [{ id: 'app', source: 'https://example.com/app.git' }] });
  try {
    store.saveEnvironment({ id: 'dev', name: 'dev', services: [{ id: 'web', image: 'node:22-alpine' }] }, {}, 0);
    const task = TaskSchema.parse({ id: 'one', projectId: 'shop', name: 'One', branch: 'task/one', state: 'ready' });
    mkdirSync(join(sandbox.path('shop'), 'tasks', 'one', 'app'), { recursive: true });
    const preview = await manager.start(project, task);
    const name = store.runtime(preview.id)!.name;
    run.mockClear();
    // Images built for the preview carry their own tag, which `--rmi local` keeps.
    run.mockImplementation(async (_command, args) => ({ stdout: args[0] === 'images' ? `${name}-web:preview\n` : '', stderr: '', exitCode: 0 }));
    await manager.remove(preview.id);
    const calls = run.mock.calls.map((call) => call[1]);
    expect(calls).toContainEqual(expect.arrayContaining(['images', '--filter', `reference=${name}-*:preview`]));
    // Only this preview's images: base images other previews share are not touched.
    expect(calls).toContainEqual(['rmi', '--force', `${name}-web:preview`]);
    const down = calls.find((args) => args.includes('down'));
    expect(down).toEqual(expect.arrayContaining(['-p', name, 'down', '--volumes', '--remove-orphans', '--rmi', 'local']));
    expect(unpublish).toHaveBeenCalledWith(name);
    expect(store.previews()).toEqual([]);
    expect(store.runtime(preview.id)).toBeUndefined();
    expect(existsSync(join(root, '.harness/runtime/previews', preview.id))).toBe(false);
    // The worktree is not the preview's to delete.
    expect(existsSync(join(sandbox.path('shop'), 'tasks', 'one', 'app'))).toBe(true);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
