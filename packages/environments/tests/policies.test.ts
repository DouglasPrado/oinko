import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { EnvironmentSchema } from '../src/contracts/index.js';
import { safePath, validateCompose } from '../src/policies/index.js';
import { EnvironmentStore } from '../src/storage/store.js';

const roots: string[] = [];
const root = () => {
  const dir = mkdtempSync(join(tmpdir(), 'oinko-environments-'));
  roots.push(dir);
  return dir;
};
afterEach(() => roots.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

it('blocks context escapes and symlink escapes before mounting or building', () => {
  const dir = root();
  const other = root();
  mkdirSync(join(dir, 'apps'));
  symlinkSync(other, join(dir, 'apps/escape'));
  expect(safePath(dir, 'apps')).toBe(realpathSync(join(dir, 'apps')));
  expect(() => safePath(dir, '../outside')).toThrow();
  expect(() => safePath(dir, 'apps/escape')).toThrow();
});

it('refuses repository compose privileges, host sockets and unreviewed includes', () => {
  const dir = root();
  for (const patch of [
    { privileged: true },
    { network_mode: 'host' },
    { volumes: ['/var/run/docker.sock:/var/run/docker.sock'] },
    { cap_add: ['SYS_ADMIN'] },
    { pid: 'host' },
  ]) {
    expect(() =>
      validateCompose({ services: { app: { image: 'node:22-alpine', ...patch } } }, dir),
    ).toThrow();
  }
  expect(() => validateCompose({ include: ['../compose.yaml'], services: {} }, dir)).toThrow();
  expect(
    validateCompose(
      {
        services: {
          app: { image: 'node:22-alpine' },
          db: { image: 'postgres:17-alpine', volumes: ['data:/var/lib/postgresql/data'] },
        },
        volumes: { data: {} },
      },
      dir,
    ).services,
  ).toHaveProperty('db');
});

it('supports per-service builders in a monorepo and rejects duplicate service IDs', () => {
  const env = EnvironmentSchema.parse({
    id: 'node',
    name: 'Node',
    services: [
      { id: 'web', repositoryId: 'app', builder: 'railpack' },
      { id: 'api', repositoryId: 'app', builder: 'dockerfile', dockerfile: 'apps/api/Dockerfile' },
      { id: 'db', builder: 'image', image: 'postgres:17-alpine' },
    ],
  });
  expect(env.services.map((service) => service.builder)).toEqual([
    'railpack',
    'dockerfile',
    'image',
  ]);
  expect(() =>
    EnvironmentSchema.parse({ ...env, services: [env.services[0], env.services[0]] }),
  ).toThrow();
});

it('stores secrets encrypted and returns only their names, preserving them on ordinary edits', () => {
  const dir = root();
  const store = new EnvironmentStore(dir);
  try {
    const env = store.saveEnvironment(
      { id: 'node', name: 'Node' },
      { DB_PASSWORD: 'private-database-secret' },
      0,
    );
    expect(env.secretNames).toEqual(['DB_PASSWORD']);
    expect(JSON.stringify(env)).not.toContain('private-database-secret');
    store.saveEnvironment({ ...env, name: 'Updated' }, {}, env.revision);
    expect(store.secrets('node').DB_PASSWORD).toBe('private-database-secret');
  } finally {
    store.close();
  }
  expect(
    readFileSync(join(dir, '.harness/environments.db')).includes(
      Buffer.from('private-database-secret'),
    ),
  ).toBe(false);
});

it('refuses a symlink as the encryption key without changing the target', () => {
  const dir = root();
  const outside = join(root(), 'unrelated-key');
  const bytes = Buffer.alloc(32, 7);
  writeFileSync(outside, bytes, { mode: 0o644 });
  mkdirSync(join(dir, '.harness'));
  symlinkSync(outside, join(dir, '.harness/environments.key'));
  expect(() => new EnvironmentStore(dir)).toThrow();
  expect(readFileSync(outside)).toEqual(bytes);
  expect(statSync(outside).mode & 0o777).toBe(0o644);
});

it('keeps the same key when reopening and refuses to replace a missing key for existing data', () => {
  const dir = root();
  let store = new EnvironmentStore(dir);
  store.saveEnvironment({ id: 'app', name: 'App' }, { TOKEN: 'retained-secret' }, 0);
  store.close();
  const keyPath = join(dir, '.harness/environments.key');
  const key = readFileSync(keyPath);
  store = new EnvironmentStore(dir);
  expect(store.secrets('app').TOKEN).toBe('retained-secret');
  store.close();
  expect(readFileSync(keyPath)).toEqual(key);
  expect(statSync(keyPath).mode & 0o777).toBe(0o600);
  rmSync(keyPath);
  expect(() => new EnvironmentStore(dir)).toThrow(/Restaure o backup/);
});

it('recovers encrypted runtime configuration larger than a single secret', () => {
  const dir = root();
  const store = new EnvironmentStore(dir);
  try {
    const runtime = {
      name: 'preview',
      path: '/tmp/compose.json',
      edgeNetwork: 'preview-edge',
      routes: [],
      runtimeEnv: { FIRST: 'a'.repeat(9000), SECOND: 'b'.repeat(9000) },
    };
    store.saveRuntime('preview', runtime);
    expect(store.runtime('preview')).toEqual(runtime);
  } finally {
    store.close();
  }
});

it('rejects indirect service dependency cycles', () => {
  expect(() =>
    EnvironmentSchema.parse({
      id: 'node',
      name: 'Node',
      services: [
        { id: 'web', dependsOn: ['api'] },
        { id: 'api', dependsOn: ['db'] },
        { id: 'db', dependsOn: ['web'] },
      ],
    }),
  ).toThrow(/ciclo/i);
});
