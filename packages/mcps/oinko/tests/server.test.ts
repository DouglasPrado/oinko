import { afterEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { EnvironmentSchema } from '@oinko/environments/contracts';
import type { RunnerCommandInput, RunnerState } from '@oinko/environments/client';
import { ProjectSchema, TaskSchema } from '@oinko/workspaces/contracts';
import { createOinkoServer } from '../src/index.js';

class Runner {
  value: RunnerState = {
    pid: 1,
    projects: [],
    environments: [],
    tasks: [],
    jobs: [],
    previews: [],
    sandboxes: {},
  };
  calls: RunnerCommandInput[] = [];
  async state() {
    return structuredClone(this.value);
  }
  async command(input: RunnerCommandInput): Promise<unknown> {
    this.calls.push(input);
    if (input.action === 'saveEnvironment') {
      const env = { ...EnvironmentSchema.parse(input.definition), revision: 1, secretNames: [] };
      this.value.environments.push(env);
      return env;
    }
    if (input.action === 'saveProject') {
      const project = { ...ProjectSchema.parse(input.definition), revision: 1 };
      this.value.projects.push(project);
      return project;
    }
    if (input.action === 'createTask') {
      const task = {
        ...TaskSchema.parse(input.definition),
        state: 'creating' as const,
        revision: 1,
      };
      this.value.tasks.push(task);
      const job = {
        id: 'job-one',
        type: input.action,
        projectId: task.projectId,
        state: 'queued' as const,
        createdAt: new Date().toISOString(),
        revision: 1,
      };
      this.value.jobs.push(job);
      return job;
    }
    if (input.action === 'jobLogs') return { text: 'latest log' };
    if (input.action === 'shell') return { stdout: '{}', stderr: '', exitCode: 7 };
    throw new Error('revision conflict');
  }
}

const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});
async function fixture() {
  const runner = new Runner();
  const server = createOinkoServer({ client: runner });
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  closes.push(async () => {
    await client.close();
    await server.close();
  });
  return { runner, client };
}

it('exposes MCP tools, a guide and a prompt with a real protocol client', async () => {
  const { client } = await fixture();
  expect(client.getServerVersion()?.name).toBe('oinko');
  const tools = await client.listTools();
  expect(tools.tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining([
      'oinko_prepare_project',
      'oinko_configure_environment',
      'oinko_inspect_repository',
      'oinko_start_preview',
      'oinko_job',
      'oinko_exec',
      'oinko_read_file',
    ]),
  );
  expect((await client.readResource({ uri: 'oinko://guide' })).contents[0]).toMatchObject({
    mimeType: 'text/markdown',
  });
  expect(
    JSON.stringify(
      await client.getPrompt({
        name: 'disponibilizar-sandbox',
        arguments: { github: 'owner/repo' },
      }),
    ),
  ).toContain('owner/repo');
});

it('prepares a GitHub project once, returns the queued job, and preserves later configuration', async () => {
  const { client, runner } = await fixture();
  const args = { repositoryUrl: 'owner/repo' };
  const first = await client.callTool({ name: 'oinko_prepare_project', arguments: args });
  expect(first.isError).not.toBe(true);
  expect(first.structuredContent).toMatchObject({
    job: { state: 'queued' },
    task: { state: 'creating' },
  });
  expect(runner.value.projects[0]?.repositories[0]?.source).toBe(
    'https://github.com/owner/repo.git',
  );
  runner.value.projects[0]!.allowedBotIds = ['dev'];
  runner.value.environments[0]!.memoryMb = 4096;
  const pending = await client.callTool({ name: 'oinko_prepare_project', arguments: args });
  expect(pending.structuredContent).toMatchObject({ task: { state: 'creating' } });
  expect(pending.structuredContent).not.toHaveProperty('job');
  runner.value.tasks[0]!.state = 'ready';
  await client.callTool({
    name: 'oinko_prepare_project',
    arguments: { repositoryUrl: 'https://github.com/owner/repo/' },
  });
  expect(runner.calls.map((c) => c.action)).toEqual([
    'saveEnvironment',
    'saveProject',
    'createTask',
  ]);
  expect(runner.value.projects[0]?.allowedBotIds).toEqual(['dev']);
  expect(runner.value.environments[0]?.memoryMb).toBe(4096);
});

it('limits job waits and exposes only the requested project in filtered status', async () => {
  const { client, runner } = await fixture();
  for (const id of ['one', 'two']) {
    runner.value.projects.push({
      ...ProjectSchema.parse({
        id,
        name: id,
        environmentId: id,
        repositories: [{ id: 'app', source: `https://github.com/owner/${id}` }],
      }),
      revision: 1,
    });
    runner.value.environments.push({
      ...EnvironmentSchema.parse({ id, name: id }),
      revision: 1,
      secretNames: [],
    });
  }
  const filtered = await client.callTool({ name: 'oinko_status', arguments: { projectId: 'one' } });
  expect(filtered.structuredContent).toMatchObject({
    projects: [{ id: 'one' }],
    environments: [{ id: 'one' }],
  });
  expect(
    (await client.callTool({ name: 'oinko_job', arguments: { jobId: 'job-one', waitSeconds: 21 } }))
      .isError,
  ).toBe(true);
  expect(
    (await client.callTool({ name: 'oinko_status', arguments: { projectId: 'missing' } })).isError,
  ).toBe(true);
});

it('rejects conflicting project identities, ambiguous reuse and changed refs without writes', async () => {
  const { client, runner } = await fixture();
  runner.value.projects.push({
    ...ProjectSchema.parse({
      id: 'existing',
      name: 'Existing',
      repositories: [{ id: 'app', source: 'https://github.com/owner/repo.git' }],
    }),
    revision: 1,
  });
  for (const args of [
    { projectId: 'existing', repositoryUrl: 'other/repo' },
    { projectId: 'existing', repositoryUrl: 'owner/repo', ref: 'release' },
  ])
    expect(
      (await client.callTool({ name: 'oinko_prepare_project', arguments: args })).isError,
    ).toBe(true);
  runner.value.projects.push({ ...runner.value.projects[0]!, id: 'duplicate' });
  expect(
    (
      await client.callTool({
        name: 'oinko_prepare_project',
        arguments: { repositoryUrl: 'owner/repo' },
      })
    ).isError,
  ).toBe(true);
  expect(runner.calls).toHaveLength(0);
});

it('validates URLs and paths, and reports command errors rather than success', async () => {
  const { client, runner } = await fixture();
  for (const url of [
    'https://token@github.com/owner/repo',
    'https://github.com/owner/repo/tree/main',
    'file:///etc/passwd',
  ]) {
    expect(
      (await client.callTool({ name: 'oinko_prepare_project', arguments: { repositoryUrl: url } }))
        .isError,
    ).toBe(true);
  }
  expect(
    (
      await client.callTool({
        name: 'oinko_read_file',
        arguments: { taskId: 'task', repositoryId: 'app', path: '../secret' },
      })
    ).isError,
  ).toBe(true);
  expect(runner.calls).toHaveLength(0);
  expect(
    (
      await client.callTool({
        name: 'oinko_exec',
        arguments: { taskId: 'task', repositoryId: 'app', command: 'exit 7' },
      })
    ).isError,
  ).toBe(true);
  expect(
    (await client.callTool({ name: 'oinko_stop_preview', arguments: { previewId: 'missing' } }))
      .isError,
  ).toBe(true);
});

it('preserves failed jobs and bounds log output', async () => {
  const { client, runner } = await fixture();
  runner.value.jobs.push({
    id: 'job-one',
    type: 'startPreview',
    state: 'failed',
    createdAt: new Date().toISOString(),
    error: 'build failed',
    revision: 1,
  });
  const failed = await client.callTool({ name: 'oinko_job', arguments: { jobId: 'job-one' } });
  expect(failed.isError).toBe(true);
  expect(failed.structuredContent).toMatchObject({
    job: { state: 'failed', error: 'build failed' },
  });
  const logs = await client.callTool({
    name: 'oinko_logs',
    arguments: { kind: 'job', id: 'job-one', tailChars: 5 },
  });
  expect(logs.structuredContent).toMatchObject({ text: 't log', truncated: true });
});
