import { describe, expect, it } from 'vitest';
import { hashParams, type CycleOutcome } from '../../src/programming/index.js';
import { botView, tempRoot, twoBotMatrix } from './helpers.js';
import {
  ScriptedExecutor,
  check,
  createService,
  deferred,
  edit,
  operator,
  until,
} from './service-helpers.js';

const done = (summary = 'Pronto'): CycleOutcome => ({ summary, traceIds: [], completion: { summary } });
const finish = (): CycleOutcome => done();
const progress = (revision: string) => (input: Parameters<ScriptedExecutor['runCycle']>[0]): CycleOutcome => {
  input.context.record(edit(revision));
  input.context.record(check(revision, 'passed'));
  return { summary: `ciclo ${input.cycle}`, traceIds: [`trace-${input.cycle}`] };
};

describe('M03-S02 background dispatch and per-bot queue', () => {
  it('returns the runId right after persistence and executes later', async () => {
    const access = twoBotMatrix();
    const gate = deferred();
    const executor = new ScriptedExecutor([
      async (input) => {
        await gate.promise;
        input.context.record(edit('r1'));
        input.context.record(check('r1', 'passed'));
        return done();
      },
    ]);
    const harness = createService(tempRoot(), access, { executor });
    const started = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'Corrigir bug' });
    expect(started.run).toMatchObject({ state: 'queued', id: expect.stringMatching(/^run-/) });
    expect(started.follow).toContain(started.run.id);
    await until(() => harness.store.getRun(started.run.id)?.state === 'running');
    gate.resolve();
    await harness.service.idle();
    expect(harness.store.getRun(started.run.id)?.state).toBe('completed');
    expect(harness.types(started.run.id)).toEqual(
      expect.arrayContaining(['run_created', 'policy_resolved', 'run_queued', 'run_dispatched', 'queue_wait_measured', 'run_completed']),
    );
    await harness.close();
  });

  it('keeps one active run per bot while two bots advance in parallel', async () => {
    const access = twoBotMatrix();
    const running = new Map<string, number>();
    let maxAlpha = 0;
    const executor = new ScriptedExecutor(() => async (input) => {
      const count = (running.get(input.run.botId) ?? 0) + 1;
      running.set(input.run.botId, count);
      if (input.run.botId === 'alpha') maxAlpha = Math.max(maxAlpha, count);
      await new Promise((resolve) => setTimeout(resolve, 20));
      input.context.record(edit(`r-${input.run.id}`));
      input.context.record(check(`r-${input.run.id}`, 'passed'));
      running.set(input.run.botId, running.get(input.run.botId)! - 1);
      return done();
    });
    const harness = createService(tempRoot(), access, { executor });
    const alpha = [1, 2, 3].map((n) => harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: `pedido ${n}` }).run.id);
    const beta = harness.service.start(operator, { botId: 'beta', projectId: 'two', text: 'outro bot' }).run.id;
    await until(() => harness.store.getRun(beta)?.state !== 'queued');
    expect(harness.store.runsInState('alpha', ['running'])).toHaveLength(1);
    await harness.service.idle();
    expect(maxAlpha).toBe(1);
    for (const id of [...alpha, beta]) expect(harness.store.getRun(id)?.state).toBe('completed');
    const order = executor.inputs.filter((input) => input.run.botId === 'alpha').map((input) => input.run.id);
    expect(order).toEqual(alpha);
    await harness.close();
  });

  it('does not create two runs for a repeated request key', () => {
    const access = twoBotMatrix();
    const harness = createService(tempRoot(), access);
    const first = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x', idempotencyKey: 'tg:1' });
    const again = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x', idempotencyKey: 'tg:1' });
    expect(again).toMatchObject({ deduplicated: true, run: { id: first.run.id } });
    expect(harness.store.listRuns({ botId: 'alpha' }).items).toHaveLength(1);
    expect(harness.types(first.run.id)).toContain('request_deduplicated');
  });

  it('survives a restart with a pending queue: another process picks it up', async () => {
    const access = twoBotMatrix();
    const dir = tempRoot();
    const accepting = createService(dir, access); // e.g. dashboard: no executor
    const id = accepting.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'fila' }).run.id;
    await accepting.close();
    const worker = createService(dir, access, { executor: new ScriptedExecutor([progress('r1'), finish]) });
    worker.service.kick();
    await until(() => worker.store.getRun(id)?.state === 'completed');
    await worker.close();
  });

  it('answers status and control while a long command is running', async () => {
    const access = twoBotMatrix();
    const gate = deferred();
    const harness = createService(tempRoot(), access, {
      executor: new ScriptedExecutor([
        async (input) => {
          await input.context.operation({ kind: 'workspace.exec', class: 'mutate', params: { command: 'pnpm test' } }, () => gate.promise);
          return { summary: 'x', traceIds: [] };
        },
      ]),
    });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'longo' }).run.id;
    await until(() => harness.store.listReceipts(id, ['running']).length === 1);
    expect(harness.service.get(operator, id).state).toBe('running');
    const control = harness.service.control(operator, id, 'pause');
    expect(control.status).toBe('requested');
    expect(harness.store.getRun(id)?.state).toBe('running'); // requested is not paused
    gate.resolve();
    await until(() => harness.store.getRun(id)?.state === 'paused');
    expect(harness.store.listReceipts(id)[0]?.state).toBe('succeeded');
    await harness.close();
  });

  it('refuses a bot starting work in another bot’s name or a project it cannot access', () => {
    const access = twoBotMatrix();
    const harness = createService(tempRoot(), access);
    expect(() => harness.service.start({ kind: 'bot', botId: 'beta' }, { botId: 'alpha', projectId: 'one', text: 'x' })).toThrow(/próprio nome/);
    expect(() => harness.service.start({ kind: 'bot', botId: 'beta' }, { botId: 'beta', projectId: 'one', text: 'x' })).toThrow(/não autorizado/);
    access.bots.set('gamma', botView('gamma', { enabled: false }));
    access.projects.set('one', { ...access.project('one')!, allowedBotIds: ['alpha', 'gamma'] });
    expect(() => harness.service.start(operator, { botId: 'gamma', projectId: 'one', text: 'x' })).toThrow(/não está habilitada/);
  });
});

describe('M03-S03 cycles and verifiable progress', () => {
  it('continues across more cycles than one loop limit until evidence satisfies criteria', async () => {
    const access = twoBotMatrix();
    const scripts = Array.from({ length: 12 }, (_, index) => (input: Parameters<ScriptedExecutor['runCycle']>[0]) => {
      input.context.record({ kind: 'information', source: 'read', fingerprint: `file-${index}` });
      return { summary: `ciclo ${input.cycle}: li arquivo ${index}`, traceIds: [] } as CycleOutcome;
    });
    scripts.push(progress('final'), finish);
    const executor = new ScriptedExecutor(scripts);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'grande' }).run.id;
    await harness.service.idle();
    expect(harness.store.getRun(id)).toMatchObject({ state: 'completed', cycleCount: 14 });
    // Objective and summary are carried between cycles.
    expect(executor.inputs[5]!.previousSummary).toContain('ciclo 5');
    expect(executor.inputs.every((input) => input.objective === 'grande')).toBe(true);
    await harness.close();
  });

  it('blocks after three cycles without new evidence and explains why', async () => {
    const access = twoBotMatrix();
    const executor = new ScriptedExecutor([
      () => {
        throw new Error('pnpm test falhou: Cannot find module x');
      },
    ]);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'loop' }).run.id;
    await harness.service.idle();
    const run = harness.store.getRun(id)!;
    expect(run.state).toBe('blocked');
    expect(run.blocked).toMatchObject({ code: 'no_progress' });
    expect(run.blocked?.message).toContain('3 ciclos');
    expect(run.blocked?.message).toContain('Cannot find module x');
    expect(executor.inputs).toHaveLength(3);
    await harness.close();
  });

  it('resets the no-progress count when new evidence appears and treats repeated commands as no progress', async () => {
    const access = twoBotMatrix();
    const same = (input: Parameters<ScriptedExecutor['runCycle']>[0]): CycleOutcome => {
      input.context.record(check('r0', 'failed'));
      return { summary: 'mesmo erro', traceIds: [] };
    };
    const executor = new ScriptedExecutor([same, same, progress('r1'), same, same, same]);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x' }).run.id;
    await harness.service.idle();
    // cycle1 new fact, cycle2 repeat(1), cycle3 progress(0), cycles 4 new(r0 failure is known) → 1, 5 → 2, 6 → 3 blocked
    expect(harness.store.getRun(id)?.state).toBe('blocked');
    expect(executor.inputs).toHaveLength(6);
    const assessed = harness.types(id).filter((type) => type === 'progress_assessed');
    expect(assessed).toHaveLength(6);
    await harness.close();
  });

  it('does not complete on a convincing claim without evidence', async () => {
    const access = twoBotMatrix();
    const executor = new ScriptedExecutor([() => done('Tudo pronto, confie em mim.'), progress('r1'), () => done('Agora sim')]);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x' }).run.id;
    await harness.service.idle();
    expect(executor.inputs[1]!.feedback).toMatch(/não foi aceita/);
    expect(harness.store.getRun(id)).toMatchObject({ state: 'completed', finalOutcome: { summary: 'Agora sim', delivery: 'technical' } });
    await harness.close();
  });

  it('never treats skipped, timeout or infrastructure checks as approval', async () => {
    const access = twoBotMatrix();
    for (const result of ['skipped', 'timeout', 'infrastructure'] as const) {
      const executor = new ScriptedExecutor([
        (input) => {
          input.context.record(edit('r1'));
          input.context.record(check('r1', result));
          return done();
        },
        finish,
        finish,
        finish,
      ]);
      const harness = createService(tempRoot(), access, { executor });
      const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: result }).run.id;
      await harness.service.idle();
      expect(harness.store.getRun(id)?.state, result).toBe('blocked');
      expect(harness.store.criteria(id).find((c) => c.id === 'checks')?.status).toBe('failed');
      await harness.close();
    }
  });

  it('invalidates approval when the code changes after the check', async () => {
    const access = twoBotMatrix();
    const executor = new ScriptedExecutor([
      progress('r1'),
      (input) => {
        input.context.record(edit('r2'));
        return done();
      },
      (input) => {
        input.context.record(check('r2', 'passed'));
        return done();
      },
    ]);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x' }).run.id;
    await harness.service.idle();
    expect(harness.types(id)).toContain('evidence_invalidated');
    expect(harness.store.getRun(id)?.state).toBe('completed');
    expect(harness.store.criteria(id).find((c) => c.id === 'checks')?.revision).toBe('r2');
    await harness.close();
  });
});

describe('M03-S04 recovery after restart', () => {
  function crashedRun(dir: string, access: ReturnType<typeof twoBotMatrix>, receiptState: 'running' | 'intended' = 'running') {
    const accepting = createService(dir, access);
    const id = accepting.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'recuperar' }).run.id;
    const run = accepting.store.getRun(id)!;
    // Simulate a worker that took the run and died between an edit and its receipt.
    accepting.store.acquireLease(id, 'dead-worker', -1);
    const running = accepting.store.transitionRun(id, run.revision, 'running', { phase: 'working' }).run;
    accepting.store.insertReceipt({
      operationId: 'op-edit',
      runId: id,
      kind: 'workspace.applyPatch',
      idempotencyKey: 'k1',
      paramsHash: hashParams({ path: 'a.ts' }),
      actor: { kind: 'system', botId: 'alpha', component: 'executor' },
      intent: {},
      preconditions: {},
      state: receiptState,
      attempt: 1,
      createdAt: 1,
    });
    return { id, running, close: () => accepting.close() };
  }

  it('reconciles an edit interrupted before its receipt instead of repeating it', async () => {
    const access = twoBotMatrix();
    const dir = tempRoot();
    const crashed = crashedRun(dir, access);
    await crashed.close();
    const reconciled: string[] = [];
    const executor = new ScriptedExecutor([progress('r1'), finish]);
    const worker = createService(dir, access, {
      executor,
      reconciler: {
        async reconcile(_run, receipt) {
          reconciled.push(receipt.operationId);
          return { resolution: 'applied', evidence: { afterHash: 'sha256:x' } };
        },
      },
    });
    worker.service.kick();
    await until(() => worker.store.getRun(crashed.id)?.state === 'completed');
    expect(reconciled).toEqual(['op-edit']);
    expect(worker.store.getReceipt('op-edit')?.state).toBe('succeeded');
    expect(worker.types(crashed.id)).toEqual(expect.arrayContaining(['recovery_started', 'operation_reconciled', 'run_resumed']));
    await worker.close();
  });

  it('blocks when the effect cannot be determined; a missing job is not proof', async () => {
    const access = twoBotMatrix();
    const dir = tempRoot();
    const crashed = crashedRun(dir, access);
    await crashed.close();
    const worker = createService(dir, access, {
      executor: new ScriptedExecutor([finish]),
      reconciler: { reconcile: async () => ({ resolution: 'unknown', evidence: { job: 'absent' } }) },
    });
    worker.service.kick();
    await until(() => worker.store.getRun(crashed.id)?.state === 'blocked');
    expect(worker.store.getRun(crashed.id)?.blocked).toMatchObject({ code: 'uncertain_operation', operationId: 'op-edit' });
    expect(worker.store.getReceipt('op-edit')?.state).toBe('uncertain');
    await worker.close();
  });

  /** A run blocked waiting for the person while one of its operations is uncertain. */
  function blockedWithUncertain(dir: string, access: ReturnType<typeof twoBotMatrix>) {
    const accepting = createService(dir, access);
    const id = accepting.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'tema escuro' }).run.id;
    const run = accepting.store.getRun(id)!;
    accepting.store.transitionRun(id, run.revision, 'blocked', { phase: 'waiting', blocked: { code: 'needs_input', message: 'Preciso de uma decisão.', needs: 'Posso seguir?' } });
    accepting.store.insertReceipt({
      operationId: 'op-edit',
      runId: id,
      kind: 'workspace.replace',
      idempotencyKey: 'k1',
      paramsHash: hashParams({ path: 'theme-toggle.tsx' }),
      actor: { kind: 'system', botId: 'alpha', component: 'executor' },
      intent: {},
      preconditions: {},
      state: 'uncertain',
      attempt: 1,
      createdAt: 1,
    });
    return { id, close: () => accepting.close() };
  }

  it('reconciles uncertain operations when a blocked run is resumed, so it can complete', async () => {
    const access = twoBotMatrix();
    const dir = tempRoot();
    const blocked = blockedWithUncertain(dir, access);
    await blocked.close();
    const reconciled: string[] = [];
    const worker = createService(dir, access, {
      executor: new ScriptedExecutor([progress('r1'), finish]),
      reconciler: {
        async reconcile(_run, receipt) {
          reconciled.push(receipt.operationId);
          return { resolution: 'not_applied', evidence: { journal: 'absent' } };
        },
      },
    });
    expect(worker.service.control(operator, blocked.id, 'resume', { note: 'pode' }).status).toBe('applied');
    worker.service.kick();
    await until(() => ['completed', 'blocked'].includes(worker.store.getRun(blocked.id)!.state));
    expect(worker.store.getRun(blocked.id)?.state).toBe('completed');
    expect(reconciled).toEqual(['op-edit']);
    expect(worker.store.getReceipt('op-edit')?.state).not.toBe('uncertain');
    await worker.close();
  });

  it('settles an operation left uncertain during a cycle before judging its completion', async () => {
    const access = twoBotMatrix();
    const dir = tempRoot();
    // The executor reaches the store of the service it runs in.
    const box: { harness?: ReturnType<typeof createService> } = {};
    const executor = new ScriptedExecutor([
      (input) => {
        input.context.record(edit('r1'));
        input.context.record(check('r1', 'passed'));
        box.harness!.store.insertReceipt({
          operationId: 'op-lost',
          runId: input.run.id,
          stepId: input.context.stepId,
          kind: 'workspace.replace',
          idempotencyKey: 'k-lost',
          paramsHash: hashParams({ path: 'a.ts' }),
          actor: { kind: 'system', botId: 'alpha', component: 'executor' },
          intent: {},
          preconditions: {},
          state: 'uncertain',
          attempt: 1,
          createdAt: 1,
        });
        return done();
      },
    ]);
    const harness = (box.harness = createService(dir, access, { executor, reconciler: { reconcile: async () => ({ resolution: 'not_applied', evidence: { journal: 'absent' } }) } }));
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'tema escuro' }).run.id;
    await until(() => ['completed', 'blocked'].includes(harness.store.getRun(id)!.state));
    expect(harness.store.getRun(id)?.state).toBe('completed');
    expect(executor.inputs).toHaveLength(1);
    await harness.close();
  });

  it('blocks again naming the operation when a resumed run still has an undeterminable one, without spending a cycle', async () => {
    const access = twoBotMatrix();
    const dir = tempRoot();
    const blocked = blockedWithUncertain(dir, access);
    await blocked.close();
    const executor = new ScriptedExecutor([finish]);
    const worker = createService(dir, access, {
      executor,
      reconciler: { reconcile: async () => ({ resolution: 'unknown', evidence: { state: 'partial' } }) },
    });
    worker.service.control(operator, blocked.id, 'resume', { note: 'pode' });
    worker.service.kick();
    await until(() => worker.store.getRun(blocked.id)?.state === 'blocked');
    expect(worker.store.getRun(blocked.id)?.blocked).toMatchObject({ code: 'uncertain_operation', operationId: 'op-edit' });
    expect(executor.inputs).toHaveLength(0);
    await worker.close();
  });

  it('treats an intent never marked running as not started', async () => {
    const access = twoBotMatrix();
    const dir = tempRoot();
    const crashed = crashedRun(dir, access, 'intended');
    await crashed.close();
    const worker = createService(dir, access, { executor: new ScriptedExecutor([progress('r1'), finish]) });
    worker.service.kick();
    await until(() => worker.store.getRun(crashed.id)?.state === 'completed');
    expect(worker.store.getReceipt('op-edit')?.error?.code).toBe('interrupted_before_start');
    await worker.close();
  });

  it('never starts two executors when two processes recover the same run', async () => {
    const access = twoBotMatrix();
    const dir = tempRoot();
    const crashed = crashedRun(dir, access, 'intended');
    await crashed.close();
    const executors = [new ScriptedExecutor([progress('r1'), finish]), new ScriptedExecutor([progress('r1'), finish])];
    const workers = executors.map((executor, index) => createService(dir, access, { executor, ownerId: `w${index}` }));
    workers.forEach((worker) => worker.service.kick());
    await until(() => workers[0]!.store.getRun(crashed.id)?.state === 'completed');
    await Promise.all(workers.map((worker) => worker.service.idle()));
    expect(executors.map((executor) => executor.inputs.length).sort()).toEqual([0, 2]);
    await Promise.all(workers.map((worker) => worker.close()));
  });

  it('pauses instead of resuming when auto-resume is off, and blocks when access was revoked', async () => {
    const access = twoBotMatrix();
    access.bots.set('alpha', botView('alpha', { autoResume: false }));
    const dir = tempRoot();
    const crashed = crashedRun(dir, access, 'intended');
    await crashed.close();
    const worker = createService(dir, access, { executor: new ScriptedExecutor([finish]) });
    worker.service.kick();
    await until(() => worker.store.getRun(crashed.id)?.state === 'paused');
    await worker.close();

    const revoked = twoBotMatrix();
    const dir2 = tempRoot();
    const second = crashedRun(dir2, revoked, 'intended');
    await second.close();
    revoked.projects.set('one', { ...revoked.project('one')!, allowedBotIds: [] });
    const worker2 = createService(dir2, revoked, { executor: new ScriptedExecutor([finish]) });
    worker2.service.kick();
    await until(() => worker2.store.getRun(second.id)?.state === 'blocked');
    expect(worker2.store.getRun(second.id)?.blocked?.code).toBe('permission_denied');
    await worker2.close();
  });
});

describe('M03-S05 pause, resume and cancel', () => {
  it('pauses during an LLM call immediately and resumes with permissions checked again', async () => {
    const access = twoBotMatrix();
    const executor = new ScriptedExecutor([
      (input) =>
        new Promise<CycleOutcome>((_, reject) => {
          input.context.signal.addEventListener('abort', () => reject(input.context.signal.reason), { once: true });
        }),
      progress('r1'),
      finish,
    ]);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x' }).run.id;
    await until(() => executor.inputs.length === 1);
    expect(harness.service.control(operator, id, 'pause').status).toBe('requested');
    await until(() => harness.store.getRun(id)?.state === 'paused');
    expect(harness.service.control(operator, id, 'pause').status).toBe('rejected');
    access.projects.set('one', { ...access.project('one')!, allowedBotIds: [] });
    expect(harness.service.control(operator, id, 'resume').message).toMatch(/não tem mais acesso/);
    access.projects.set('one', { ...access.project('one')!, allowedBotIds: ['alpha'] });
    expect(harness.service.control(operator, id, 'resume').status).toBe('applied');
    await harness.service.idle();
    expect(harness.store.getRun(id)?.state).toBe('completed');
    expect(harness.types(id)).toEqual(expect.arrayContaining(['control_requested', 'run_paused', 'run_resumed']));
    await harness.close();
  });

  it('cancels during a tool, reports the uncertain effect and never rolls back', async () => {
    const access = twoBotMatrix();
    const executor = new ScriptedExecutor([
      async (input) => {
        await input.context.operation({ kind: 'workspace.exec', class: 'mutate', params: { command: 'sleep 100' } }, () =>
          new Promise((_, reject) => input.context.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
        );
        return { summary: 'nunca', traceIds: [] };
      },
    ]);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x' }).run.id;
    await until(() => harness.store.listReceipts(id, ['running']).length === 1);
    const first = harness.service.control(operator, id, 'cancel');
    expect(first.status).toBe('requested');
    expect(harness.service.control(operator, id, 'cancel').message).toMatch(/já registrado/);
    await until(() => harness.store.getRun(id)?.state === 'cancelled');
    const run = harness.store.getRun(id)!;
    expect(run.finalOutcome?.uncertainOperations).toHaveLength(1);
    expect(harness.service.control(operator, id, 'cancel').status).toBe('rejected');
    expect(harness.service.control(operator, id, 'resume').status).toBe('rejected');
    expect(harness.types(id)).toEqual(expect.arrayContaining(['operation_uncertain', 'run_cancelled', 'process_terminated']));
    await harness.close();
  });

  it('cancels a queued run at once and controls from another conversation are refused', () => {
    const access = twoBotMatrix();
    const harness = createService(tempRoot(), access);
    const chat = { kind: 'channel' as const, botId: 'alpha', channel: 'telegram', conversationId: '10' };
    const id = harness.service.start(chat, { botId: 'alpha', projectId: 'one', text: 'x' }).run.id;
    expect(() => harness.service.control({ ...chat, conversationId: '99' }, id, 'cancel')).toThrow(/não encontrado/);
    expect(harness.service.control(chat, id, 'cancel')).toMatchObject({ status: 'applied', run: { state: 'cancelled' } });
  });
});

describe('M03-S06 user direction and delivery criteria', () => {
  it('applies a direction at the next safe point without creating another run', async () => {
    const access = twoBotMatrix();
    const gate = deferred();
    const executor = new ScriptedExecutor([
      async (input) => {
        await gate.promise;
        input.context.record({ kind: 'information', source: 'read', fingerprint: 'a' });
        return { summary: '1', traceIds: [] };
      },
      progress('r1'),
      finish,
    ]);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'corrigir cart' }).run.id;
    await until(() => executor.inputs.length === 1);
    const steer = harness.service.control(operator, id, 'steer', { text: 'Use a API nova, não a legada.' });
    expect(steer.status).toBe('requested');
    gate.resolve();
    await harness.service.idle();
    expect(executor.inputs[1]!.directions).toEqual(['Use a API nova, não a legada.']);
    expect(harness.store.planRevisions(id).map((plan) => plan.source)).toEqual(['request', 'user']);
    expect(harness.store.listRuns({ botId: 'alpha' }).items).toHaveLength(1);
    expect(harness.types(id)).toEqual(expect.arrayContaining(['user_direction_received', 'plan_revised']));
    await harness.close();
  });

  /** First cycle asks a question; later cycles finish. */
  const asks = (question: string) => (): CycleOutcome => ({ summary: 'Preciso de uma decisão.', traceIds: [], needsInput: question });

  it('delivers the answer given on resume to the next cycle, next to the question it answers', async () => {
    const access = twoBotMatrix();
    const executor = new ScriptedExecutor([asks('Posso fazer commit dos testes?'), progress('r1'), finish]);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'tema escuro' }).run.id;
    await until(() => harness.store.getRun(id)?.state === 'blocked');
    harness.service.control(operator, id, 'resume', { note: 'pode, e depois conclua' });
    await harness.service.idle();
    expect(harness.store.getRun(id)?.state).toBe('completed');
    const [answer] = executor.inputs[1]!.directions;
    expect(answer).toContain('Posso fazer commit dos testes?');
    expect(answer).toContain('pode, e depois conclua');
    // Delivered once, not again in later cycles.
    expect(executor.inputs[2]!.directions).toEqual([]);
    await harness.close();
  });

  it('a direction sent while the run waits for an answer is the answer: it resumes the run and reaches the agent', async () => {
    const access = twoBotMatrix();
    const executor = new ScriptedExecutor([asks('Qual tema usar por padrão?'), progress('r1'), finish]);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'tema escuro' }).run.id;
    await until(() => harness.store.getRun(id)?.state === 'blocked');
    const steer = harness.service.control(operator, id, 'steer', { text: 'Use o do sistema e finalize.' });
    expect(steer).toMatchObject({ status: 'applied', run: { state: 'queued' } });
    await harness.service.idle();
    expect(harness.store.getRun(id)?.state).toBe('completed');
    expect(executor.inputs[1]!.directions.join('\n')).toContain('Use o do sistema e finalize.');
    await harness.close();
  });

  it('keeps a direction sent to a paused run for its next cycle', async () => {
    const access = twoBotMatrix();
    const gate = deferred();
    const executor = new ScriptedExecutor([
      async (input) => {
        await gate.promise;
        input.context.record({ kind: 'information', source: 'read', fingerprint: 'a' });
        return { summary: '1', traceIds: [] };
      },
      progress('r1'),
      finish,
    ]);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x' }).run.id;
    await until(() => executor.inputs.length === 1);
    harness.service.control(operator, id, 'pause');
    gate.resolve();
    await until(() => harness.store.getRun(id)?.state === 'paused');
    expect(harness.service.control(operator, id, 'steer', { text: 'Priorize os testes.' }).run.state).toBe('paused');
    harness.service.control(operator, id, 'resume');
    await harness.service.idle();
    expect(executor.inputs[1]!.directions).toEqual(['Priorize os testes.']);
    await harness.close();
  });

  it('requires confirmation for an incompatible objective and records the decision', () => {
    const access = twoBotMatrix();
    const harness = createService(tempRoot(), access);
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'corrigir cart' }).run.id;
    const refused = harness.service.control(operator, id, 'steer', { text: 'mude tudo', objective: 'reescrever checkout' });
    expect(refused.status).toBe('rejected');
    const confirmed = harness.service.control(operator, id, 'steer', { text: 'mude tudo', objective: 'reescrever checkout', confirm: true });
    // Accepted into the plan; the agent reads it when the queued run first executes.
    expect(confirmed.status).toBe('requested');
    expect(harness.store.planRevisions(id).at(-1)).toMatchObject({ objective: 'reescrever checkout', compatible: false });
    expect(harness.types(id).filter((type) => type === 'decision_recorded')).toHaveLength(2);
  });

  it('invalidates checks when criteria change after tests', async () => {
    const access = twoBotMatrix();
    const gate = deferred();
    const executor = new ScriptedExecutor([
      async (input) => {
        input.context.record(edit('r1'));
        input.context.record(check('r1', 'passed'));
        return { summary: '1', traceIds: [] };
      },
      async (input) => {
        await gate.promise;
        input.context.record(check('r1', 'passed', 'lint'));
        return done();
      },
    ]);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x' }).run.id;
    await until(() => executor.inputs.length === 2);
    harness.service.control(operator, id, 'steer', {
      text: 'Precisa passar no lint também',
      criteria: [
        { id: 'changes', kind: 'diff', description: 'Alterações' },
        { id: 'lint', kind: 'check', description: 'Lint aprovado' },
      ],
    });
    gate.resolve();
    await harness.service.idle();
    expect(harness.types(id)).toContain('evidence_invalidated');
    expect(harness.store.criteria(id).map((criterion) => [criterion.id, criterion.status])).toEqual([
      ['changes', 'satisfied'],
      ['lint', 'satisfied'],
    ]);
    await harness.close();
  });

  it('never lets an analysis-only request modify the project', async () => {
    const access = twoBotMatrix();
    let effect = false;
    const executor = new ScriptedExecutor([
      async (input) => {
        await expect(
          input.context.operation({ kind: 'workspace.replace', class: 'mutate', params: {} }, async () => {
            effect = true;
          }),
        ).rejects.toMatchObject({ code: 'analysis_only' });
        input.context.record({ kind: 'report', fingerprint: 'report-1' });
        return done('Relatório: o carrinho recalcula frete duas vezes.');
      },
    ]);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'analise', mode: 'analysis' }).run.id;
    await harness.service.idle();
    expect(effect).toBe(false);
    expect(harness.store.getRun(id)).toMatchObject({ state: 'completed', finalOutcome: { delivery: 'technical' } });
    expect(harness.types(id)).toContain('permission_denied');
    await harness.close();
  });

  it('keeps technical completion distinct from a draft PR and human acceptance', async () => {
    const access = twoBotMatrix();
    const executor = new ScriptedExecutor([
      (input) => {
        input.context.record(edit('r1'));
        input.context.record(check('r1', 'passed'));
        input.context.record({ kind: 'publication', repositoryId: 'app', sha: 'abc', prNumber: 3, fingerprint: 'pr-3' });
        return done();
      },
    ]);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'two', text: 'x' }).run.id;
    await harness.service.idle();
    expect(harness.store.getRun(id)?.finalOutcome?.delivery).toBe('draft_pr');
    expect(harness.store.criteria(id).map((criterion) => criterion.id)).toEqual(['changes', 'checks', 'draft_pr']);
    await harness.close();
  });
});
