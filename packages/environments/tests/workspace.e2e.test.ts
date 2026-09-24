/* eslint-disable @typescript-eslint/no-explicit-any -- runner replies are untyped JSON */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '../src/contracts/index.js';
import { RuntimeFixture, eventually } from './helpers/runtime.js';

/**
 * M02 against the shipped runner process and a real Docker sandbox: every
 * operation crosses the Unix socket and runs inside the project container.
 */
describe.skipIf(process.env.OINKO_DOCKER_TEST !== '1')('workspace operations in the Docker sandbox', () => {
  let f: RuntimeFixture;
  const location = { taskId: 'change', repositoryId: 'app' };
  const call = (command: Record<string, unknown>) => f.coder.command<any>(command as never);
  async function check(command: string, extra: Record<string, unknown> = {}) {
    const job = await call({ action: 'startCheck', ...location, operationId: `op-${Math.random()}`, kind: 'test', command, ...extra });
    return eventually(
      async () => (await call({ action: 'inspectJob', jobId: job.id })).job as Job,
      (value) => value.state !== 'running' && value.state !== 'queued',
      120_000,
    );
  }
  beforeEach(async () => {
    f = new RuntimeFixture();
    await f.start();
    await f.configure();
    await f.task();
  }, 300_000);
  afterEach(async () => {
    await f.cleanup();
  }, 120_000);

  it('searches, reads by range, patches with preconditions and diffs inside the container', async () => {
    await f.shell('printf "rascunho" > USER_NOTES.txt');
    const baseline = await call({ action: 'gitSnapshot', ...location });
    const found = await call({ action: 'searchContent', ...location, query: 'original' });
    expect(found.matches).toEqual([expect.objectContaining({ path: 'packages/shared/message.txt', line: 1 })]);
    const read = await call({ action: 'readRange', ...location, path: 'packages/shared/message.txt' });
    const done = await call({
      action: 'applyPatch',
      ...location,
      operationId: 'op-patch',
      edits: [
        { action: 'replace', path: 'packages/shared/message.txt', expectedHash: read.hash, oldText: 'original', newText: 'alterado' },
        { action: 'create', path: 'packages/shared/nova.txt', content: 'nova' },
      ],
    });
    expect(done.applied.sort()).toEqual(['packages/shared/message.txt', 'packages/shared/nova.txt']);
    await expect(
      call({ action: 'replaceExact', ...location, operationId: 'op-stale', path: 'packages/shared/message.txt', expectedHash: read.hash, oldText: 'alterado', newText: 'x' }),
    ).rejects.toThrow(/pré-condições/);
    const diff = await call({ action: 'gitDiff', ...location, baseline: { headSha: baseline.headSha, files: baseline.files } });
    expect(diff.runFiles).toEqual(['packages/shared/message.txt', 'packages/shared/nova.txt']);
    expect(diff.preexisting).toEqual(['USER_NOTES.txt']);
    expect(diff.patch).toContain('+alterado');
    expect(diff.revision).toBe(done.revision);
    await expect(call({ action: 'readRange', ...location, path: '../../../../etc/passwd' })).rejects.toThrow();
  }, 300_000);

  it('fixes a bug proven by a failing test and binds the passing check to the exact revision', async () => {
    await f.write('sum.cjs', 'module.exports = (a, b) => a - b;\n');
    await f.write('sum.test.cjs', "const sum = require('./sum.cjs'); if (sum(2, 3) !== 5) { console.error('esperado 5, recebido ' + sum(2, 3)); process.exit(1); } console.log('ok');\n");
    const failing = await check('node sum.test.cjs');
    expect(failing.result).toMatchObject({ result: 'failed', classification: 'code', exitCode: 1 });
    expect((failing.result as any).outputTail).toContain('esperado 5');
    const read = await call({ action: 'readRange', ...location, path: 'sum.cjs' });
    const fix = await call({ action: 'replaceExact', ...location, operationId: 'op-fix', path: 'sum.cjs', expectedHash: read.hash, oldText: 'a - b', newText: 'a + b' });
    const passing = await check('node sum.test.cjs');
    expect(passing.result).toMatchObject({ result: 'passed', stale: false, revisionBefore: fix.revision, revisionAfter: fix.revision });
    expect((failing.result as any).revisionBefore).not.toBe(fix.revision);
  }, 300_000);

  it('classifies infrastructure failures, bounds long output and detects edits made during a check', async () => {
    const missing = await check('definitely-not-a-command --version', { kind: 'install' });
    expect(missing.result).toMatchObject({ result: 'infrastructure', classification: 'environment' });
    const noisy = await check('node -e "for (let i = 0; i < 40000; i++) console.log(\'linha \' + i + \' \' + \'x\'.repeat(40))"');
    expect((noisy.result as any).outputBytes).toBeGreaterThan(1_000_000);
    expect((noisy.result as any).outputTail.length).toBeLessThanOrEqual(4000);
    expect((await f.coder.command<{ text: string }>({ action: 'jobLogs', jobId: noisy.id })).text.length).toBeGreaterThan(0);
    const job = await call({ action: 'startCheck', ...location, operationId: 'op-slow', kind: 'test', command: 'sleep 3; exit 0' });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await f.write('changed-during-check.txt', 'x');
    const stale = await eventually(async () => (await call({ action: 'inspectJob', jobId: job.id })).job as Job, (v) => v.state !== 'running', 60_000);
    expect(stale.result).toMatchObject({ result: 'passed', stale: true });
  }, 300_000);

  it('times out, stops a TERM-resistant process group and never reports it as passed', async () => {
    const timeout = await check('sleep 60', { timeoutSeconds: 2 });
    expect(timeout.result).toMatchObject({ result: 'timeout' });
    const job = await call({ action: 'startCheck', ...location, operationId: 'op-resist', kind: 'test', command: "trap '' TERM; sleep 120 & wait" });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const stopped = await call({ action: 'stopJob', jobId: job.id, graceSeconds: 2 });
    expect(stopped).toMatchObject({ stopped: true, escalated: true });
    expect(stopped.job).toMatchObject({ cancelled: true, result: { result: 'cancelled' } });
    // The bracket keeps pgrep from matching its own command line.
    const survivors = await f.shell('pgrep -f "sleep 12[0]" || true');
    expect(survivors.stdout.trim()).toBe('');
  }, 300_000);

  it('reattaches a check that survived a runner restart and keeps its real result', async () => {
    const job = await call({ action: 'startCheck', ...location, operationId: 'op-restart', kind: 'test', command: 'sleep 4; echo terminou; exit 0' });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await f.stop('SIGKILL');
    await f.start();
    const finished = await eventually(async () => (await call({ action: 'inspectJob', jobId: job.id })).job as Job, (v) => v.state !== 'running', 60_000);
    expect(finished).toMatchObject({ state: 'succeeded', interrupted: false, result: { result: 'passed' } });
    expect((finished.result as any).outputTail).toContain('terminou');
  }, 300_000);

  it('recovers a patch interrupted after the first write in the container', async () => {
    await f.stop();
    await f.start({ OINKO_FAULT_EDIT_AFTER_WRITES: '1' });
    await f.write('one.txt', '1');
    await f.write('two.txt', '2');
    const one = await call({ action: 'readRange', ...location, path: 'one.txt' });
    const two = await call({ action: 'readRange', ...location, path: 'two.txt' });
    const edits = [
      { action: 'replace', path: 'one.txt', expectedHash: one.hash, oldText: '1', newText: 'um' },
      { action: 'replace', path: 'two.txt', expectedHash: two.hash, oldText: '2', newText: 'dois' },
    ];
    await expect(call({ action: 'applyPatch', ...location, operationId: 'op-partial', edits })).rejects.toThrow(/Falha injetada/);
    await f.stop('SIGKILL');
    await f.start();
    expect(await call({ action: 'reconcileEdit', ...location, operationId: 'op-partial' })).toMatchObject({ state: 'partial', applied: ['one.txt'], pending: ['two.txt'] });
    await call({ action: 'applyPatch', ...location, operationId: 'op-partial', edits });
    expect((await f.read('two.txt')).text).toBe('dois');
    expect((await f.read('one.txt')).text).toBe('um');
  }, 300_000);
});
