import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { TaskSchema } from '@oinko/workspaces';
import { EnvironmentSchema, type CommandRunner } from '../src/contracts/index.js';
import { prepareCompose } from '../src/runtime/compose.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture(yaml: string) {
  const root = mkdtempSync(join(tmpdir(), 'oinko-compose-'));
  roots.push(root);
  const source = join(root, 'tasks/change/app');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'compose.yaml'), yaml);
  writeFileSync(join(source, 'Dockerfile'), 'FROM node:22-alpine AS development');
  return { root, source };
}
const task = TaskSchema.parse({
  id: 'change',
  projectId: 'project',
  name: 'Change',
  branch: 'task/change',
});

it('imports build targets, scoped variables and container-side shell expansion without inheriting the host', async () => {
  const { root } = fixture(`services:
  web:
    build:
      context: .
      target: development
      args:
        VERSION: \${VERSION:-22}
    command: [sh, -c, 'echo $$TOKEN; node server.cjs']
    environment:
      TOKEN: \${TOKEN}
    depends_on: [db]
  db:
    image: redis:8-alpine
`);
  const calls: string[][] = [];
  const run: CommandRunner = async (command, args) => {
    calls.push([command, ...args]);
    return { stdout: '', stderr: '', exitCode: 0 };
  };
  const environment = EnvironmentSchema.parse({
    id: 'node',
    name: 'Node',
    compose: { repositoryId: 'app', path: 'compose.yaml' },
    services: [{ id: 'web', expose: true, secrets: ['TOKEN'], environment: { VERSION: '24' } }],
  });
  const prepared = await prepareCompose({
    root,
    workspace: root,
    task,
    environment,
    name: 'test',
    directory: join(root, 'runtime'),
    secrets: { TOKEN: 'private-value', OTHER: 'not-for-web' },
    run,
  });
  const output = JSON.parse(readFileSync(prepared.path, 'utf8'));
  expect(calls.find((args) => args[1] === 'build')).toEqual(
    expect.arrayContaining(['--target', 'development', '--build-arg', 'VERSION=24']),
  );
  expect(output.services.web.command).toEqual(['sh', '-c', 'echo $$TOKEN; node server.cjs']);
  expect(output.services.web.depends_on).toEqual(['db']);
  expect(JSON.stringify(output)).not.toContain('private-value');
  expect(Object.values(prepared.runtimeEnv)).toContain('private-value');
  expect(Object.values(prepared.runtimeEnv)).not.toContain('not-for-web');
});

it('refuses access to secrets not selected for the imported service', async () => {
  const { root } = fixture(
    'services:\n  web:\n    image: node:22-alpine\n    environment:\n      TOKEN: ${OTHER}\n',
  );
  await expect(
    prepareCompose({
      root,
      workspace: root,
      task,
      environment: EnvironmentSchema.parse({
        id: 'node',
        name: 'Node',
        compose: { repositoryId: 'app', path: 'compose.yaml' },
      }),
      name: 'test',
      directory: join(root, 'runtime'),
      secrets: { OTHER: 'not-for-web' },
      run: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    }),
  ).rejects.toThrow(/OTHER/);
});

it('keeps long container hostnames within DNS limits without collisions between services', async () => {
  const { root } = fixture('services: {}');
  const prepare = (name: string) =>
    prepareCompose({
      root,
      workspace: root,
      task,
      environment: EnvironmentSchema.parse({
        id: 'node',
        name: 'Node',
        services: ['dashboard', 'dashboard-admin'].map((id) => ({ id, expose: true })),
      }),
      name,
      directory: join(root, 'runtime'),
      secrets: {},
      run: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    });
  const name = 'oinko-0123456789-p-fazer-versao-dark-do-dashboard-b82e12';
  const first = await prepare(name);
  const containers = first.routes.map((route) => route.container);
  for (const container of containers) {
    expect(container.length).toBeLessThanOrEqual(63);
    expect(container).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
  }
  expect(new Set(containers).size).toBe(2);
  const output = JSON.parse(readFileSync(first.path, 'utf8')) as {
    services: Record<string, { container_name: string }>;
  };
  for (const route of first.routes)
    expect(output.services[route.serviceId]?.container_name).toBe(route.container);
  expect((await prepare(name)).routes.map((route) => route.container)).toEqual(containers);
  expect((await prepare('short')).routes[0]?.container).toBe('short-dashboard');
});
