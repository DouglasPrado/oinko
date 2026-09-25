import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ProjectSchema, TaskSchema, WorktreeManager } from '../src/index.js';
import type { WorkspaceExecutor } from '../src/contracts/index.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'oinko-worktree-ref-'));
  roots.push(root);
  const source = join(root, 'source');
  const workspace = join(root, 'workspace');
  mkdirSync(source);
  mkdirSync(join(workspace, 'repositories'), { recursive: true });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@localhost',
        ...args,
      ],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  git(source, 'init', '-b', 'main');
  const commit = (text: string) => {
    writeFileSync(join(source, 'message.txt'), text);
    git(source, 'add', '.');
    git(source, 'commit', '-m', text);
    return git(source, 'rev-parse', 'HEAD');
  };
  const initial = commit('initial');
  const project = ProjectSchema.parse({
    id: 'project',
    name: 'Project',
    repositories: [{ id: 'app', source: 'https://example.test/repo.git' }],
  });
  const hostPath = (path: string) => path.replace(/^\/workspace(?=\/|$)/, workspace);
  // Real Git clones/fetches; only replace the transport URL with a local origin.
  const executor: WorkspaceExecutor = {
    async git(_project, args, cwd) {
      return git(
        hostPath(cwd),
        ...args.map((arg) => (arg === project.repositories[0]!.source ? source : hostPath(arg))),
      );
    },
    async importLocal() {
      throw new Error('Unexpected local import');
    },
  };
  const manager = new WorktreeManager(executor);
  const create = async (id: string, ref = 'HEAD') => {
    await manager.create(
      { ...project, repositories: project.repositories.map((repo) => ({ ...repo, ref })) },
      TaskSchema.parse({ id, name: id, projectId: project.id, branch: `task/${id}` }),
    );
    return join(workspace, 'tasks', id, 'app');
  };
  return { source, workspace, git, commit, initial, create };
}

it('starts new remote tasks at the latest default branch and preserves existing worktrees', async () => {
  const f = fixture();
  const first = await f.create('first');
  writeFileSync(join(first, 'message.txt'), 'work in progress');
  const latest = f.commit('updated');
  const second = await f.create('second');
  expect(f.git(second, 'rev-parse', 'HEAD')).toBe(latest);
  expect(readFileSync(join(second, 'message.txt'), 'utf8')).toBe('updated');
  expect(f.git(first, 'rev-parse', 'HEAD')).toBe(f.initial);
  // Retrying an existing worktree must not fetch, move its branch, or touch edits.
  renameSync(f.source, `${f.source}-offline`);
  expect(await f.create('first')).toBe(first);
  expect(readFileSync(join(first, 'message.txt'), 'utf8')).toBe('work in progress');
});

it('fetches selected branches and honors tags and pinned commits', async () => {
  const f = fixture();
  await f.create('first');
  f.git(f.source, 'tag', 'v1');
  f.git(f.source, 'switch', '-c', 'release');
  const latest = f.commit('release');
  for (const [id, ref, expected] of [
    ['branch', 'release', latest],
    ['remote', 'origin/release', latest],
    ['full', 'refs/remotes/origin/release', latest],
    ['tag', 'v1', f.initial],
    ['pinned', f.initial, f.initial],
  ]) {
    const path = await f.create(id!, ref!);
    expect(f.git(path, 'rev-parse', 'HEAD')).toBe(expected);
  }
});

it('does not silently use a stale remote base when fetching fails', async () => {
  const f = fixture();
  await f.create('first');
  renameSync(f.source, `${f.source}-offline`);
  await expect(f.create('second')).rejects.toThrow();
});

it('makes Git trust only content and mtime in the sandbox clone, so a mounted folder never fakes local changes', async () => {
  const f = fixture();
  await f.create('first');
  const repository = join(f.workspace, 'repositories', 'app');
  // On a host folder mounted into the sandbox, ctime and inode flicker: Git then
  // refuses rebase and merge over "local changes" that do not exist.
  expect(f.git(repository, 'config', '--get', 'core.trustctime')).toBe('false');
  expect(f.git(repository, 'config', '--get', 'core.checkStat')).toBe('minimal');
  // A clone made before the setting existed gets it on the next task.
  f.git(repository, 'config', '--unset', 'core.checkStat');
  await f.create('second');
  expect(f.git(repository, 'config', '--get', 'core.checkStat')).toBe('minimal');
});
