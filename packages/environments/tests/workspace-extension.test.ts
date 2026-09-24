/* eslint-disable @typescript-eslint/no-explicit-any -- runner replies are untyped JSON */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EnvironmentController } from '../src/runtime/controller.js';
import { WorkspaceExtension, type OpsTransport } from '../src/workspace/extension.js';
import { runOpsLocally } from '../src/workspace/ops.js';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));
const sha = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

/**
 * Real controller and stores; ops run in-process against the task's host
 * worktree instead of `docker exec` (the container path is covered by Docker e2e).
 */
function setup(options: { faultAfterWrites?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oinko-ws-ext-'));
  const local: OpsTransport = {
    run: (project, task, repositoryId, request) =>
      runOpsLocally({ ...request, root: join(root, '.harness/workspaces', project.id, 'tasks', task.id, repositoryId) }) as Promise<Record<string, unknown>>,
  };
  const make = (faultAfterWrites?: number) =>
    new EnvironmentController(root, {
      extensions: [new WorkspaceExtension({ transport: () => local, ...(faultAfterWrites !== undefined && { faultAfterWrites }) })],
    });
  let controller = make(options.faultAfterWrites);
  cleanup.push(() => {
    controller.close();
    rmSync(root, { recursive: true, force: true });
  });
  controller.environments.saveEnvironment({ id: 'node', name: 'Node' }, {}, 0);
  for (const id of ['shop', 'other'])
    controller.workspaces.saveProject(
      { id, name: id, environmentId: 'node', repositories: [{ id: 'app', source: 'https://example.com/a.git' }], allowedBotIds: id === 'shop' ? ['alpha', 'beta'] : ['beta'] },
      0,
    );
  controller.workspaces.saveTask({ id: 'fix', projectId: 'shop', name: 'Fix', branch: 'task/fix', state: 'ready' }, 0);
  const worktree = join(root, '.harness/workspaces/shop/tasks/fix/app');
  mkdirSync(join(worktree, 'src'), { recursive: true });
  writeFileSync(join(worktree, 'src/a.ts'), 'A');
  writeFileSync(join(worktree, 'src/b.ts'), 'B');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: worktree });
  execFileSync('git', ['add', '-A'], { cwd: worktree });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@l', 'commit', '-q', '-m', 'i'], { cwd: worktree });
  const call = (command: Record<string, unknown>, botId = 'alpha') => controller.handle({ command, botId }) as Promise<any>;
  return {
    root,
    worktree,
    call,
    restart(faultAfterWrites?: number) {
      controller.close();
      controller = make(faultAfterWrites);
    },
  };
}
const location = { taskId: 'fix', repositoryId: 'app' };
const patch = (operationId: string) => ({
  action: 'applyPatch',
  ...location,
  operationId,
  edits: [
    { action: 'replace', path: 'src/a.ts', expectedHash: sha('A'), oldText: 'A', newText: 'A2' },
    { action: 'replace', path: 'src/b.ts', expectedHash: sha('B'), oldText: 'B', newText: 'B2' },
  ],
});

describe('workspace extension', () => {
  it('reads by range with a hash and replaces with the hash as precondition', async () => {
    const { call, worktree } = setup();
    const read = await call({ action: 'readRange', ...location, path: 'src/a.ts' });
    expect(read.hash).toBe(sha('A'));
    const done = await call({ action: 'replaceExact', ...location, operationId: 'op-1', path: 'src/a.ts', expectedHash: read.hash, oldText: 'A', newText: 'A!' });
    expect(done).toMatchObject({ ok: true, applied: ['src/a.ts'], revision: expect.stringMatching(/^tree:/) });
    expect(readFileSync(join(worktree, 'src/a.ts'), 'utf8')).toBe('A!');
    await expect(
      call({ action: 'replaceExact', ...location, operationId: 'op-2', path: 'src/a.ts', expectedHash: read.hash, oldText: 'A', newText: 'x' }),
    ).rejects.toMatchObject({ code: 'edit_conflict' });
  });

  it('replays a confirmed patch instead of applying it twice', async () => {
    const { call, worktree } = setup();
    const first = await call(patch('op-same'));
    const again = await call(patch('op-same'));
    expect(again).toMatchObject({ replayed: true, applied: first.applied });
    expect(readFileSync(join(worktree, 'src/a.ts'), 'utf8')).toBe('A2');
    await expect(call({ ...patch('op-same'), edits: [patch('x').edits[0]] })).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('recovers a patch interrupted after its first write, finishing only what is pending', async () => {
    const context = setup({ faultAfterWrites: 1 });
    await expect(context.call(patch('op-crash'))).rejects.toThrow(/Falha injetada/);
    expect(readFileSync(join(context.worktree, 'src/a.ts'), 'utf8')).toBe('A2');
    expect(readFileSync(join(context.worktree, 'src/b.ts'), 'utf8')).toBe('B');
    context.restart();
    const reconciled = await context.call({ action: 'reconcileEdit', ...location, operationId: 'op-crash' });
    expect(reconciled).toMatchObject({ found: true, state: 'partial', applied: ['src/a.ts'], pending: ['src/b.ts'], conflicted: [] });
    const resumed = await context.call(patch('op-crash'));
    expect(resumed.applied.sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(readFileSync(join(context.worktree, 'src/b.ts'), 'utf8')).toBe('B2');
    expect((await context.call({ action: 'reconcileEdit', ...location, operationId: 'op-crash' })).state).toBe('applied');
  });

  it('never overwrites a file changed by the user during recovery', async () => {
    const context = setup({ faultAfterWrites: 1 });
    await expect(context.call(patch('op-user'))).rejects.toThrow();
    writeFileSync(join(context.worktree, 'src/b.ts'), 'B-do-usuario');
    context.restart();
    await expect(context.call(patch('op-user'))).rejects.toMatchObject({ code: 'external_change' });
    expect(readFileSync(join(context.worktree, 'src/b.ts'), 'utf8')).toBe('B-do-usuario');
    expect((await context.call({ action: 'reconcileEdit', ...location, operationId: 'op-user' })).conflicted).toEqual(['src/b.ts']);
  });

  it('authorizes every operation by project and hides other bots’ journals', async () => {
    const { call } = setup();
    await call(patch('op-alpha'));
    await expect(call({ action: 'readRange', ...location, path: 'src/a.ts' }, 'intruder')).rejects.toThrow(/não autorizado/);
    await expect(call({ action: 'searchContent', ...location, query: 'A' }, 'intruder')).rejects.toThrow(/não autorizado/);
    expect(await call({ action: 'reconcileEdit', ...location, operationId: 'op-alpha' }, 'beta')).toMatchObject({ found: false });
    await expect(call(patch('op-alpha'), 'beta')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('uses project command overrides in the discovered context', async () => {
    const { call, root } = setup();
    const controller = new EnvironmentController(root);
    const project = controller.workspaces.project('shop');
    controller.workspaces.saveProject(
      { ...project, programming: { commands: [{ repositoryId: 'app', path: '.', kind: 'test', command: 'make check' }] } },
      project.revision,
    );
    controller.close();
    const context = await call({ action: 'projectContext', ...location, targets: ['src/a.ts'] });
    expect(context.commands).toContainEqual({ kind: 'test', command: 'make check', cwd: '.', origin: 'override' });
  });
});
