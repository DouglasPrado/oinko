import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { EnvironmentClient } from '@oinko/environments/client';
import type { RunnerState } from '@oinko/environments/client';
import type { Job } from '@oinko/environments/contracts';

interface Fixture {
  root: string;
  namespace: string;
  client: Client;
  control: EnvironmentClient;
  docker: boolean;
}
const fixtures: Fixture[] = [];
async function fixture(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'oinko-mcp-e2e-'));
  const namespace = `oinko-${createHash('sha256').update(root).digest('hex').slice(0, 10)}`;
  const client = new Client({ name: 'oinko-e2e', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), '--root', root],
    env: { PATH: process.env.PATH!, HOME: process.env.HOME!, TMPDIR: join(root, 'mcp-tmp') },
    stderr: 'pipe',
  });
  await client.connect(transport);
  const control = new EnvironmentClient(root);
  const result = { root, namespace, client, control, docker: false };
  fixtures.push(result);
  return result;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.client.close();
    const state = await f.control.state();
    process.kill(state.pid, 'SIGTERM');
    for (let i = 0; i < 100; i++) {
      try {
        process.kill(state.pid, 0);
      } catch {
        break;
      }
      await delay(20);
    }
    if (f.docker) {
      for (const [list, remove] of [
        [
          ['ps', '-aq', '--filter', `name=^${f.namespace}-`],
          ['rm', '-f'],
        ],
        [
          ['network', 'ls', '-q', '--filter', `name=^${f.namespace}-`],
          ['network', 'rm'],
        ],
        [
          ['volume', 'ls', '-q', '--filter', `name=^${f.namespace}-`],
          ['volume', 'rm'],
        ],
        [
          [
            'image',
            'ls',
            '--format',
            '{{.Repository}}:{{.Tag}}',
            '--filter',
            `reference=${f.namespace}-*`,
          ],
          ['image', 'rm'],
        ],
      ]) {
        const read = () => execFileSync('docker', list!, { encoding: 'utf8' }).trim();
        const ids = [...new Set(read().split(/\s+/).filter(Boolean))];
        if (ids.length) execFileSync('docker', [...remove!, ...ids], { stdio: 'pipe' });
        expect(read()).toBe('');
      }
    }
    rmSync(f.root, { recursive: true, force: true });
  }
}, 60_000);

async function call<T>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
  if (result.isError) throw new Error(JSON.stringify(result.structuredContent ?? result.content));
  return result.structuredContent as T;
}
async function finished(client: Client, job: Job) {
  for (let i = 0; i < 10; i++) {
    const result = await call<{ job: Job }>(client, 'oinko_job', {
      jobId: job.id,
      waitSeconds: 20,
    });
    if (result.job.state === 'succeeded') return result.job;
  }
  throw new Error(`Job timed out: ${job.id}`);
}
async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
async function probe(url: string) {
  const parsed = new URL(url);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = get(
      {
        hostname: '127.0.0.1',
        port: parsed.port,
        path: '/',
        headers: { Host: parsed.host },
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode!, body }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('HTTP timeout')));
  });
}

it('prints a ready-to-use connection without starting a runner', () => {
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const result = JSON.parse(
    execFileSync(process.execPath, [cli, '--root', '/tmp/oinko-config-example', '--print-config'], {
      encoding: 'utf8',
    }),
  );
  expect(result.mcpServers.oinko).toMatchObject({
    command: process.execPath,
    args: [cli, '--root', '/tmp/oinko-config-example'],
  });
  expect(result.mcpServers.oinko.env.PATH).toBe(process.env.PATH);
});

it('shares one runner across clients with different TMPDIR values and keeps it alive after disconnect', async () => {
  const f = await fixture();
  expect(f.client.getServerVersion()?.name).toBe('oinko');
  expect(f.client.getServerVersion()?.icons?.[0]?.mimeType).toBe('image/png');
  expect((await f.client.listTools()).tools.length).toBe(17);
  const state = await call<RunnerState>(f.client, 'oinko_status');
  expect(state.projects).toEqual([]);
  await f.client.close();
  expect((await f.control.state()).pid).toBe(state.pid);
});

it.skipIf(process.env.OINKO_DOCKER_TEST !== '1')(
  'prepares GitHub through MCP and serves the selected worktree over real Docker and HTTP',
  async () => {
    const f = await fixture();
    f.docker = true;
    await call(f.client, 'oinko_configure_network', {
      definition: { port: await freePort() },
      revision: 0,
    });
    const prepared = await call<{ project: { id: string }; task: { id: string }; job: Job }>(
      f.client,
      'oinko_prepare_project',
      { repositoryUrl: 'octocat/Hello-World', projectId: 'mcp-test' },
    );
    await finished(f.client, prepared.job);
    const location = { taskId: prepared.task.id, repositoryId: 'app' };
    expect(await call(f.client, 'oinko_read_file', { ...location, path: 'README' })).toMatchObject({
      text: expect.stringContaining('Hello World'),
    });
    await call(f.client, 'oinko_write_file', {
      ...location,
      path: 'apps/web/package.json',
      content: JSON.stringify({ name: 'mcp-fixture', scripts: { start: 'node server.cjs' } }),
    });
    await call(f.client, 'oinko_write_file', {
      ...location,
      path: 'apps/web/server.cjs',
      content:
        "require('http').createServer((q,r)=>r.end('oinko-mcp-ready')).listen(3000,'0.0.0.0')",
    });
    await call(f.client, 'oinko_write_file', {
      ...location,
      path: 'Dockerfile',
      content:
        'FROM node:22-alpine\nWORKDIR /app\nCOPY apps/web/server.cjs ./server.cjs\nCMD ["node","server.cjs"]\n',
    });
    await call(f.client, 'oinko_exec', {
      ...location,
      command: 'ln -s /etc/passwd apps/web/compose.yaml',
    });
    const inspected = await call<{ files: { path: string }[] }>(
      f.client,
      'oinko_inspect_repository',
      location,
    );
    expect(inspected.files.map((p) => p.path)).toEqual(
      expect.arrayContaining(['apps/web/package.json', 'Dockerfile']),
    );
    expect(inspected.files.map((p) => p.path)).not.toContain('apps/web/compose.yaml');
    const state = await call<RunnerState>(f.client, 'oinko_status', { projectId: 'mcp-test' });
    const environment = state.environments[0]!;
    await call(f.client, 'oinko_configure_environment', {
      definition: {
        ...environment,
        services: [{ id: 'web', repositoryId: 'app', builder: 'dockerfile', expose: true }],
      },
      revision: environment.revision,
    });
    const conflict = await f.client.callTool({
      name: 'oinko_configure_environment',
      arguments: { definition: environment, revision: environment.revision },
    });
    expect(conflict.isError).toBe(true);
    const started = await call<Job>(f.client, 'oinko_start_preview', { taskId: prepared.task.id });
    await finished(f.client, started);
    const ready = await call<RunnerState>(f.client, 'oinko_status');
    expect(ready.previews[0]?.state).toBe('ready');
    expect(await probe(ready.previews[0]!.urls[0]!.url)).toEqual({
      status: 200,
      body: 'oinko-mcp-ready',
    });
    await f.client.close();
    expect(await probe(ready.previews[0]!.urls[0]!.url)).toEqual({
      status: 200,
      body: 'oinko-mcp-ready',
    });
    // Closing MCP must preserve the shared runner; cleanup remains scoped to this fixture.
    expect((await f.control.state()).pid).toBe(ready.pid);
  },
  240_000,
);
