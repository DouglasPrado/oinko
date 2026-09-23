import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { afterEach, expect, it } from 'vitest';
import { ProjectSchema, TaskSchema, WorkspaceStore } from '../src/index.js';
import { LocalDatabase } from '../src/storage/database.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const project = {
  id: 'loja',
  name: 'Loja',
  environmentId: 'node',
  repositories: [{ id: 'app', source: 'https://example.com/loja.git' }],
  allowedBotIds: ['programmer'],
};

it('supports project-first setup and multiple environments without changing legacy projects', () => {
  expect(
    ProjectSchema.parse({ ...project, environmentId: undefined }).environmentId,
  ).toBeUndefined();
  expect(
    ProjectSchema.parse({ ...project, environmentIds: ['review', 'staging'] }).environmentIds,
  ).toEqual(['review', 'staging']);
  expect(ProjectSchema.parse(project).environmentId).toBe('node');
  expect(() => ProjectSchema.parse({ ...project, environmentIds: ['review', 'review'] })).toThrow();
});

it('models a monorepo as one repository and related repositories as one project', () => {
  expect(ProjectSchema.parse(project).repositories).toHaveLength(1);
  expect(
    ProjectSchema.parse({
      ...project,
      repositories: [...project.repositories, { id: 'api', source: 'https://example.com/api.git' }],
    }).repositories,
  ).toHaveLength(2);
  expect(() =>
    ProjectSchema.parse({
      ...project,
      repositories: [...project.repositories, ...project.repositories],
    }),
  ).toThrow();
});

it('rejects traversal identifiers and dangerous git references before execution', () => {
  expect(() => ProjectSchema.parse({ ...project, id: '../escape' })).toThrow();
  for (const branch of ['--upload-pack=bad', 'x..y', 'a@{b', 'bad name', '../main']) {
    expect(() => TaskSchema.parse({ id: 'one', projectId: 'loja', name: 'One', branch })).toThrow();
  }
});

it('refuses credentials embedded in Git URLs and invalid local paths', () => {
  for (const source of [
    'https://user:token@example.com/repo.git',
    'https://example.com/repo.git?token=secret',
    'https://example.com/repo.git#secret',
    '/tmp/repo\0suffix',
  ]) {
    expect(() =>
      ProjectSchema.parse({ ...project, repositories: [{ id: 'app', source }] }),
    ).toThrow();
  }
});

it('persists revisions and enforces bot authorization independently of caller tools', () => {
  const root = mkdtempSync(join(tmpdir(), 'oinko-workspaces-'));
  roots.push(root);
  const store = new WorkspaceStore(root);
  try {
    const saved = store.saveProject(project, 0);
    expect(saved.revision).toBe(1);
    expect(() => store.saveProject(project, 0)).toThrow(/alterad/);
    expect(store.authorize('loja', 'programmer').id).toBe('loja');
    expect(() => store.authorize('loja', 'intruder')).toThrow(/autorizad/);
    store.saveTask({ id: 'one', projectId: 'loja', name: 'One', branch: 'task/one' }, 0);
    expect(store.tasks('loja')[0]?.branch).toBe('task/one');
  } finally {
    store.close();
  }
  const reopened = new WorkspaceStore(root);
  try {
    expect(reopened.projects()[0]?.name).toBe('Loja');
  } finally {
    reopened.close();
  }
});

it('waits for a concurrent initializer before enabling WAL', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oinko-database-lock-'));
  roots.push(root);
  const path = join(root, 'state.db');
  const worker = new Worker(
    `const { DatabaseSync } = require('node:sqlite');
     const { parentPort, workerData } = require('node:worker_threads');
     const db = new DatabaseSync(workerData);
     db.exec('CREATE TABLE blocker (id INTEGER); BEGIN EXCLUSIVE');
     parentPort.postMessage('locked');
     setTimeout(() => { db.exec('COMMIT'); db.close(); }, 300);`,
    { eval: true, workerData: path },
  );
  const finished = once(worker, 'exit');
  try {
    await once(worker, 'message');
    const db = new LocalDatabase(path);
    try {
      expect(db.list('project')).toEqual([]);
    } finally {
      db.close();
    }
  } finally {
    await finished;
  }
});
