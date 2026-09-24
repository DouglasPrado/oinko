/* eslint-disable @typescript-eslint/no-explicit-any -- journal payloads are untyped JSON */
import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { controlRequest, serviceSocketPath } from '@oinko/agent-runtime/control';
import { readJournal } from '@oinko/agent-runtime/programming';
import { createHash } from 'node:crypto';
import { EnvironmentClient, environmentRequest } from '@oinko/environments/client';
import { runCommand } from '@oinko/environments/command';
import { BotStore } from '../src/store.js';
import { openProgramming } from '../src/programming/runtime.js';

/**
 * Durable programming run across real process boundaries: bot worker
 * process → shipped environment runner → Docker sandbox → Git worktree, with
 * a scripted model provider. The worker is crashed with SIGKILL mid-check.
 */
describe.skipIf(process.env.OINKO_DOCKER_TEST !== '1')('programming run through worker, runner and Docker', () => {
  let root: string;
  let workers: ChildProcess[] = [];
  afterEach(async () => {
    for (const worker of workers) if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
    workers = [];
    // Stop this root's runner and remove only this root's containers.
    const health = await environmentRequest<{ pid: number }>(root, '/health', undefined, 1000).catch(() => undefined);
    if (health?.pid) process.kill(health.pid, 'SIGTERM');
    await delay(500);
    const namespace = `oinko-${createHash('sha256').update(root).digest('hex').slice(0, 10)}`;
    const ids = (await runCommand('docker', ['ps', '-aq', '--filter', `name=^${namespace}-`])).stdout.trim().split(/\s+/).filter(Boolean);
    if (ids.length) await runCommand('docker', ['rm', '-f', ...ids]);
    rmSync(root, { recursive: true, force: true });
  }, 120_000);

  async function setup() {
    root = mkdtempSync(join(tmpdir(), 'oinko-prog-e2e-'));
    const source = join(root, 'source');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'sum.cjs'), 'module.exports = (a, b) => a - b;\n');
    writeFileSync(join(source, 'sum.test.cjs'), "const sum = require('./sum.cjs'); if (sum(2, 3) !== 5) { console.error('esperado 5'); process.exit(1); } console.log('ok');\n");
    writeFileSync(join(source, 'AGENTS.md'), 'Teste: node sum.test.cjs\n');
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: source });
    execFileSync('git', ['add', '-A'], { cwd: source });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@l', 'commit', '-q', '-m', 'fixture'], { cwd: source });
    const admin = new EnvironmentClient(root, undefined, {
      runnerPath: fileURLToPath(new URL('../../../apps/environment-runner/dist/main.js', import.meta.url)),
    });
    await admin.command({ action: 'saveEnvironment', definition: { id: 'node', name: 'Node' }, revision: 0 });
    await admin.command({
      action: 'saveProject',
      definition: { id: 'shop', name: 'Shop', environmentId: 'node', repositories: [{ id: 'app', source }], allowedBotIds: ['alpha'] },
      revision: 0,
    });
    const store = new BotStore(root);
    store.save(
      { id: 'alpha', name: 'Alpha', model: 'scripted', systemPrompt: 'Você programa.', programmingPolicy: { enabled: true } },
      { apiKey: 'sk-test-key-e2e-0123456789' },
      0,
    );
    const dataDir = store.runtime('alpha').paths.dataDir;
    store.close();
    return { socket: serviceSocketPath(dataDir) };
  }

  async function startWorker(mode = 'bug') {
    const worker = fork(fileURLToPath(new URL('./fixtures/programming-worker.mjs', import.meta.url)), [root, 'alpha', mode], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, OINKO_ROOT: root },
    });
    workers.push(worker);
    await once(worker, 'message');
    return worker;
  }

  function observe() {
    return openProgramming({ root, producer: 'test-observer' });
  }
  async function until<T>(read: () => T, done: (value: T) => boolean, ms = 300_000): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      const value = read();
      if (done(value)) return value;
      if (Date.now() > deadline) throw new Error(`timeout: ${JSON.stringify(value)}`);
      await delay(500);
    }
  }

  it('accepts over the channel, survives a disconnect and fixes the bug in the Docker sandbox', async () => {
    const { socket } = await setup();
    await startWorker();
    const answer = await controlRequest<{ answer: string }>(socket, '/message', { sessionId: 's1', text: '/tarefa Corrija a função sum.' });
    expect(answer.answer).toMatch(/Trabalho registrado: #([a-f0-9]{8}) \(shop\)/);
    const observer = observe();
    try {
      const run = await until(
        () => observer.store.listRuns({ botId: 'alpha' }).items[0]!,
        (value) => ['completed', 'failed', 'blocked', 'cancelled'].includes(value?.state ?? ''),
      );
      expect(run.state, JSON.stringify(run.blocked)).toBe('completed');
      const worktree = join(root, '.harness/workspaces/shop/tasks', run.taskId!, 'app');
      expect(readFileSync(join(worktree, 'sum.cjs'), 'utf8')).toContain('a + b');
      expect(observer.store.criteria(run.id).every((criterion) => criterion.status === 'satisfied')).toBe(true);
      const checks = readJournal(observer.database, { runId: run.id, type: 'check_finished' }).map((event) => event.envelope.payload?.result);
      expect(checks).toEqual(['failed', 'passed']);
      const status = await controlRequest<{ answer: string }>(socket, '/message', { sessionId: 's1', text: '/status' });
      expect(status.answer).toMatch(/Nenhum trabalho ativo|concluído/);
    } finally {
      await observer.close();
    }
  }, 600_000);

  it('recovers after the worker is killed during a check without repeating the edit', async () => {
    const { socket } = await setup();
    const first = await startWorker('slow-check');
    await controlRequest(socket, '/message', { sessionId: 's1', text: '/tarefa Corrija a função sum.' });
    const observer = observe();
    try {
      const run = await until(
        () => observer.store.listRuns({ botId: 'alpha' }).items[0]!,
        (value) => !!value && observer.store.listReceipts(value.id).filter((receipt) => receipt.kind === 'workspace.check' && receipt.state === 'running').length === 1 && observer.store.listReceipts(value.id).some((receipt) => receipt.kind === 'workspace.replace'),
      );
      first.kill('SIGKILL');
      await once(first, 'exit');
      await startWorker('bug');
      const done = await until(
        () => observer.store.getRun(run.id)!,
        (value) => ['completed', 'failed', 'blocked', 'cancelled'].includes(value.state),
      );
      expect(done.state, JSON.stringify(done.blocked)).toBe('completed');
      const types = readJournal(observer.database, { runId: run.id }).map((event) => event.envelope.type);
      expect(types).toEqual(expect.arrayContaining(['recovery_started', 'operation_reconciled', 'run_resumed']));
      // The edit was applied exactly once; a later attempt on changed content is refused, not re-applied.
      const replaces = observer.store.listReceipts(run.id).filter((receipt) => receipt.kind === 'workspace.replace');
      expect(replaces.filter((receipt) => receipt.state === 'succeeded')).toHaveLength(1);
      expect(replaces.filter((receipt) => receipt.state !== 'succeeded').every((receipt) => receipt.state === 'failed')).toBe(true);
    } finally {
      await observer.close();
    }
  }, 600_000);
});
