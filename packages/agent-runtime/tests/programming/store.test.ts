import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KnownFailure,
  OperationRecorder,
  ProgrammingDatabase,
  ProgrammingStore,
  hashParams,
  readJournal,
} from '../../src/programming/index.js';
import { makeRun, openStore, twoBotMatrix } from './helpers.js';

describe('ProgrammingStore', () => {
  it('restores the complete state and references after reopening the database', () => {
    const access = twoBotMatrix();
    const { dir, database, store } = openStore();
    const run = makeRun(access, 'alpha', 'two', { repositoryIds: ['app'], conversationId: 'cli:x' });
    store.insertRun(run, hashParams(run.request));
    store.createStep({ id: 'step-1', runId: run.id, kind: 'cycle', status: 'running', attempt: 1, objective: 'Ciclo 1', inputRefs: [], outputRefs: [], evidenceRefs: [], traceIds: ['trace-1'], createdAt: 1 });
    store.addPlanRevision({ runId: run.id, revision: 0, plan: ['ler', 'editar'], objective: run.request.text, reason: 'pedido', source: 'request', compatible: true, createdAt: 1 });
    store.upsertCriterion(run.id, { id: 'tests', description: 'Testes passam', kind: 'check', status: 'pending', evidenceRefs: [] });
    store.upsertPublication({ id: 'pub-1', botId: 'alpha', projectId: 'two', taskId: 'task-a', repositoryId: 'app', branch: 'task/a', originatingRunId: run.id, contributingRunIds: [], draft: true, prState: 'open', checkRefs: [], reconciliationState: 'synced', prNumber: 7, createdAt: 1, updatedAt: 1 });
    database.close();
    const reopened = new ProgrammingDatabase(join(dir, 'programming.db'));
    reopened.open();
    const again = new ProgrammingStore(reopened);
    expect(again.getRun(run.id)).toMatchObject({ id: run.id, conversationId: 'cli:x', policySnapshot: run.policySnapshot });
    expect(again.listSteps(run.id)[0]).toMatchObject({ id: 'step-1', traceIds: ['trace-1'] });
    expect(again.planRevisions(run.id)[0]?.plan).toEqual(['ler', 'editar']);
    expect(again.criteria(run.id)[0]?.id).toBe('tests');
    expect(again.publicationsForRun(run.id)[0]?.prNumber).toBe(7);
    reopened.close();
  });

  it('never silently overwrites concurrent writes to plan or progress', () => {
    const access = twoBotMatrix();
    const { store } = openStore();
    const run = store.insertRun(makeRun(access, 'alpha', 'one'), 'h').run;
    const first = store.updateRun(run.id, run.revision, { planRevision: 1 });
    expect(() => store.updateRun(run.id, run.revision, { cycleCount: 5 })).toThrow(
      expect.objectContaining({ code: 'revision_conflict' }),
    );
    expect(store.getRun(run.id)).toMatchObject({ planRevision: 1, cycleCount: 0, revision: first.revision });
    expect(() => store.transitionRun(run.id, first.revision, 'completed')).toThrow(/queued → completed/);
  });

  it('deduplicates the same request key and rejects a different request with that key', () => {
    const access = twoBotMatrix();
    const { store } = openStore();
    const run = makeRun(access, 'alpha', 'one', { idempotencyKey: 'telegram:update:10' });
    expect(store.insertRun(run, 'hash-a').deduplicated).toBe(false);
    const again = store.insertRun({ ...run, id: makeRun(access, 'alpha', 'one').id }, 'hash-a');
    expect(again).toMatchObject({ deduplicated: true, run: { id: run.id } });
    expect(() => store.insertRun({ ...run, id: makeRun(access, 'alpha', 'one').id }, 'hash-b')).toThrow(
      expect.objectContaining({ code: 'idempotency_conflict' }),
    );
    // Keys are per bot: another bot may reuse the same external key.
    const other = makeRun(access, 'beta', 'two', { idempotencyKey: 'telegram:update:10' });
    expect(store.insertRun(other, 'hash-a').deduplicated).toBe(false);
  });

  it('paginates stably without duplicates and filters by identity', () => {
    const access = twoBotMatrix();
    let clock = 1000;
    const { store } = openStore(undefined, () => clock);
    for (let i = 0; i < 25; i++) {
      clock += i % 3 === 0 ? 0 : 1; // same timestamps force the id tie-breaker
      store.insertRun(makeRun(access, i % 2 ? 'alpha' : 'beta', 'two', { createdAt: clock, updatedAt: clock }), `h${i}`);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = store.listRuns({ limit: 7, ...(cursor && { cursor }) });
      seen.push(...page.items.map((run) => run.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect(store.listRuns({ botId: 'alpha', limit: 100 }).items.every((run) => run.botId === 'alpha')).toBe(true);
    expect(store.listRuns({ botIds: [] }).items).toEqual([]);
    expect(() => store.listRuns({ cursor: 'garbage' })).toThrow(/Cursor/);
  });

  it('gives a run to exactly one executor until its lease expires', () => {
    const access = twoBotMatrix();
    let clock = 1000;
    const { store } = openStore(undefined, () => clock);
    const run = store.insertRun(makeRun(access, 'alpha', 'one'), 'h').run;
    expect(store.acquireLease(run.id, 'worker-a', 5000)).toBe(true);
    expect(store.acquireLease(run.id, 'worker-b', 5000)).toBe(false);
    expect(store.acquireLease(run.id, 'worker-a', 5000)).toBe(true);
    clock += 6000;
    expect(store.acquireLease(run.id, 'worker-b', 5000)).toBe(true);
    expect(store.acquireLease(run.id, 'worker-a', 5000)).toBe(false);
  });

  it('serializes writers on the same worktree across bots', () => {
    const { store } = openStore();
    expect(store.acquireWorktree('two', 'task-a', 'app', 'run-a', 60_000)).toBe(true);
    expect(store.acquireWorktree('two', 'task-a', 'app', 'run-b', 60_000)).toBe(false);
    expect(store.acquireWorktree('two', 'task-b', 'app', 'run-b', 60_000)).toBe(true);
    store.releaseWorktrees('run-a');
    expect(store.acquireWorktree('two', 'task-a', 'app', 'run-b', 60_000)).toBe(true);
  });

  it('keeps a multi-repository run and references to expired artifacts', () => {
    const access = twoBotMatrix();
    access.projects.set('multi', { ...access.project('two')!, id: 'multi', repositories: [{ id: 'app' }, { id: 'api' }] });
    const { store } = openStore();
    const run = store.insertRun(makeRun(access, 'alpha', 'multi', { repositoryIds: ['app', 'api'] }), 'h').run;
    store.createStep({ id: 'step-x', runId: run.id, kind: 'check', status: 'succeeded', attempt: 1, objective: 'tests', inputRefs: [], outputRefs: ['art-expired'], evidenceRefs: ['art-expired'], traceIds: [], createdAt: 1 });
    expect(store.getRun(run.id)?.repositoryIds).toEqual(['app', 'api']);
    expect(store.getStep('step-x')?.evidenceRefs).toEqual(['art-expired']);
  });
});

describe('OperationRecorder', () => {
  function setup() {
    const access = twoBotMatrix();
    const context = openStore();
    const run = context.store.insertRun(makeRun(access, 'alpha', 'two'), 'h').run;
    const recorder = new OperationRecorder(context.store, context.journal, access);
    return { ...context, access, run, recorder };
  }
  const actor = { kind: 'bot' as const, botId: 'alpha' };
  const spec = { kind: 'workspace.replace', class: 'mutate' as const, params: { path: 'a.ts', text: 'x' } };

  it('persists intent before the effect and the result after it', async () => {
    const { store, database, run, recorder } = setup();
    let seenDuringEffect: string | undefined;
    const outcome = await recorder.run(run, actor, spec, async (ctx) => {
      seenDuringEffect = store.getReceipt(ctx.operationId)?.state;
      return { applied: ['a.ts'] };
    });
    expect(seenDuringEffect).toBe('running');
    expect(outcome.receipt).toMatchObject({ state: 'succeeded', result: { applied: ['a.ts'] } });
    const types = readJournal(database, { runId: run.id }).map((event) => event.envelope.type);
    expect(types).toEqual(['permission_checked', 'operation_intended', 'operation_finished']);
  });

  it('never executes a confirmed success twice for the same request', async () => {
    const { run, recorder } = setup();
    let calls = 0;
    const effect = async () => ++calls;
    await recorder.run(run, actor, spec, effect);
    const again = await recorder.run(run, actor, spec, effect);
    expect(calls).toBe(1);
    expect(again.replayed).toBe(true);
    await expect(
      recorder.run(run, actor, { ...spec, idempotencyKey: again.receipt.idempotencyKey, params: { other: 1 } }, effect),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('marks unknown failures of mutations uncertain and refuses a blind retry', async () => {
    const { run, recorder, store, database } = setup();
    await expect(
      recorder.run(run, actor, spec, async () => {
        throw new Error('socket hang up');
      }),
    ).rejects.toThrow('socket hang up');
    expect(store.listReceipts(run.id)[0]?.state).toBe('uncertain');
    await expect(recorder.run(run, actor, spec, async () => 1)).rejects.toMatchObject({
      code: 'uncertain_operation',
    });
    expect(readJournal(database, { type: 'operation_uncertain' })).toHaveLength(1);
  });

  it('retries known failures under the same logical operation with a new attempt', async () => {
    const { run, recorder } = setup();
    await expect(
      recorder.run(run, actor, spec, async () => {
        throw new KnownFailure('stale', 'Conteúdo mudou.');
      }),
    ).rejects.toThrow('Conteúdo mudou.');
    const retry = await recorder.run(run, actor, spec, async () => 'ok');
    expect(retry.receipt).toMatchObject({ state: 'succeeded', attempt: 2 });
  });

  it('refuses the effect when the intent cannot be persisted', async () => {
    const { run, recorder, database } = setup();
    let ran = false;
    database.db.exec('DROP TABLE operation_receipts');
    await expect(
      recorder.run(run, actor, spec, async () => {
        ran = true;
      }),
    ).rejects.toThrow();
    expect(ran).toBe(false);
  });

  it('denies operations after revocation and records the denial', async () => {
    const { run, recorder, access, database } = setup();
    access.projects.set('two', { ...access.project('two')!, allowedBotIds: ['beta'] });
    let ran = false;
    await expect(
      recorder.run(run, actor, spec, async () => {
        ran = true;
      }),
    ).rejects.toMatchObject({ code: 'permission_denied' });
    expect(ran).toBe(false);
    expect(readJournal(database, { type: 'permission_denied' })[0]?.envelope.status).toBe('denied');
  });

  it('classifies interrupted receipts after a crash and reconciles them explicitly', async () => {
    const { run, recorder, store } = setup();
    store.insertReceipt({ operationId: 'op-a', runId: run.id, kind: 'k', idempotencyKey: 'a', paramsHash: 'p', actor, intent: {}, preconditions: {}, state: 'intended', attempt: 1, createdAt: 1 });
    store.insertReceipt({ operationId: 'op-b', runId: run.id, kind: 'k', idempotencyKey: 'b', paramsHash: 'p', actor, intent: {}, preconditions: {}, state: 'running', attempt: 1, createdAt: 2 });
    const marked = recorder.markInterrupted(run);
    expect(marked.map((receipt) => receipt.state)).toEqual(['failed', 'uncertain']);
    expect(recorder.reconcile(run, 'op-b', 'unknown', { job: 'absent' }).state).toBe('uncertain');
    expect(recorder.reconcile(run, 'op-b', 'applied', { hash: 'sha256:x' }).state).toBe('succeeded');
  });
});
