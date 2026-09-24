import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { EnvironmentClient, environmentRequest } from '../../src/client/index.js';
import type { Job } from '../../src/contracts/index.js';
import type { RunnerCommandInput } from '../../src/contracts/requests.js';
import { runCommand } from '../../src/runtime/command.js';

export async function eventually<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 90_000,
) {
  const deadline = Date.now() + ms;
  let value: T;
  do {
    value = await read();
    if (done(value)) return value;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Runtime did not reach expected state: ${JSON.stringify(value)}`);
}

export async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** All calls cross a Unix socket into the shipped runner in a separate process. */
export class RuntimeFixture {
  readonly root = mkdtempSync(join(tmpdir(), 'oinko-runtime-e2e-'));
  readonly source = join(this.root, 'source');
  readonly namespace = `oinko-${createHash('sha256').update(this.root).digest('hex').slice(0, 10)}`;
  readonly client = new EnvironmentClient(this.root);
  readonly coder = new EnvironmentClient(this.root, 'coder');
  private child?: ChildProcess;

  async start(env: NodeJS.ProcessEnv = {}) {
    const log = openSync(join(this.root, 'runner.log'), 'a', 0o600);
    this.child = fork(
      fileURLToPath(new URL('../../../../apps/environment-runner/dist/main.js', import.meta.url)),
      [],
      {
        execArgv: [],
        env: { ...process.env, OINKO_ROOT: this.root, ...env },
        stdio: ['ignore', log, log, 'ipc'],
      },
    );
    closeSync(log);
    await eventually(
      () =>
        environmentRequest<{ ready: boolean }>(this.root, '/health', undefined, 1000).catch(() => ({
          ready: false,
        })),
      (health) => health.ready,
      30_000,
    );
  }
  async stop(signal: NodeJS.Signals = 'SIGTERM') {
    if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) return;
    const exit = once(this.child, 'exit');
    this.child.kill(signal);
    await exit;
  }
  async repository() {
    mkdirSync(join(this.source, 'apps/web'), { recursive: true });
    mkdirSync(join(this.source, 'packages/shared'), { recursive: true });
    writeFileSync(join(this.source, 'packages/shared/message.txt'), 'original');
    writeFileSync(
      join(this.source, 'apps/web/server.cjs'),
      "console.log(process.env.TOKEN || 'started');require('node:http').createServer((req,res)=>res.end(require('node:fs').readFileSync('packages/shared/message.txt')+'|'+(process.env.PUBLIC_VALUE||''))).listen(3000,'0.0.0.0')",
    );
    writeFileSync(
      join(this.source, 'Dockerfile'),
      'FROM node:22-alpine AS web\nARG PUBLIC_VALUE=default\nENV PUBLIC_VALUE=$PUBLIC_VALUE\nWORKDIR /app\nCOPY . .\nCMD ["node","apps/web/server.cjs"]\nFROM web AS unused\nRUN exit 42\n',
    );
    await runCommand('git', ['init', '-b', 'main', this.source]);
    await runCommand('git', ['-C', this.source, 'add', '.']);
    await runCommand('git', [
      '-C',
      this.source,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@localhost',
      'commit',
      '-m',
      'fixture',
    ]);
  }
  async configure() {
    await this.repository();
    await this.client.command({
      action: 'saveEnvironment',
      definition: { id: 'node', name: 'Node' },
      revision: 0,
    });
    await this.client.command({
      action: 'saveProject',
      definition: {
        id: 'project',
        name: 'Project',
        environmentId: 'node',
        allowedBotIds: ['coder'],
        repositories: [
          { id: 'app', source: this.source },
          { id: 'api', source: this.source },
        ],
      },
      revision: 0,
    });
  }
  async wait(job: Job, expected: Job['state'] = 'succeeded') {
    const result = await eventually(
      async () => (await this.client.state()).jobs.find((item) => item.id === job.id)!,
      (item) => item.state === 'succeeded' || item.state === 'failed',
      200_000,
    );
    if (result.state !== expected)
      throw new Error(`Expected ${expected}: ${JSON.stringify(result)}`);
    return result;
  }
  async job(command: RunnerCommandInput, expected: Job['state'] = 'succeeded') {
    return this.wait(await this.client.command<Job>(command), expected);
  }
  task(id = 'change', projectId = 'project') {
    return this.job({
      action: 'createTask',
      definition: { id, projectId, name: id, branch: `task/${id}` },
    });
  }
  shell(command: string, taskId = 'change') {
    return this.coder.command<{ stdout: string; stderr: string; exitCode: number }>({
      action: 'shell',
      taskId,
      repositoryId: 'app',
      command,
    });
  }
  async write(path: string, content: string, taskId = 'change') {
    return this.coder.command({ action: 'writeFile', taskId, repositoryId: 'app', path, content });
  }
  async read(path: string, taskId = 'change') {
    return this.coder.command<{ text: string }>({
      action: 'readFile',
      taskId,
      repositoryId: 'app',
      path,
    });
  }
  async cleanup() {
    await this.stop('SIGKILL');
    // Select only resources in this fixture's namespace. Never prune the daemon.
    for (const [kind, list, remove] of [
      ['containers', ['ps', '-aq', '--filter', `name=^${this.namespace}-`], ['rm', '-f']],
      [
        'networks',
        ['network', 'ls', '-q', '--filter', `name=^${this.namespace}-`],
        ['network', 'rm'],
      ],
      ['volumes', ['volume', 'ls', '-q', '--filter', `name=^${this.namespace}-`], ['volume', 'rm']],
      [
        'images',
        [
          'image',
          'ls',
          '--format',
          '{{.Repository}}:{{.Tag}}',
          '--filter',
          `reference=${this.namespace}-*`,
        ],
        ['image', 'rm'],
      ],
    ] as const) {
      const ids = [
        ...new Set(
          (await runCommand('docker', [...list])).stdout.trim().split(/\s+/).filter(Boolean),
        ),
      ];
      if (ids.length) await runCommand('docker', [...remove, ...ids]);
      if ((await runCommand('docker', [...list])).stdout.trim())
        throw new Error(`Leaked ${kind} for ${this.namespace}`);
    }
    rmSync(this.root, { recursive: true, force: true });
  }
}
