import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@oinko/core';
import { AgentRuntime } from '../../src/index.js';
import {
  AgentCycleExecutor,
  ChannelCommands,
  ProgrammingError,
  RunNotifier,
  RunQueries,
  channelActor,
  programmingChatTools,
  readJournal,
  type CycleOutcome,
  type Evidence,
  type StreamingAgent,
} from '../../src/programming/index.js';
import { tempRoot, twoBotMatrix } from './helpers.js';
import { ScriptedExecutor, check, createService, deferred, edit, operator, until } from './service-helpers.js';

const done = (summary = 'Pronto'): CycleOutcome => ({ summary, traceIds: [], completion: { summary } });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const route = { channel: 'telegram', connectionId: '123', conversationId: '42' };

describe('M01-S04 time split per cycle', () => {
  it('separates context preparation, model wait and tool execution from the total', async () => {
    class SlowAgent implements StreamingAgent {
      async *stream(): AsyncIterable<AgentEvent> {
        await wait(30);
        yield { type: 'agent_start', traceId: 't', threadId: 'x', model: 'm' } as AgentEvent;
        await wait(30);
        yield { type: 'tool_call_start', toolCall: { id: 'c1', type: 'function', function: { name: 'workspace_read_range', arguments: '{}' } } } as AgentEvent;
        await wait(40);
        yield { type: 'tool_call_end', toolCallId: 'c1', result: { content: 'ok' }, duration: 40 } as AgentEvent;
        await wait(30);
        yield { type: 'text_delta', content: 'feito' } as AgentEvent;
        yield { type: 'agent_end', traceId: 't', reason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, duration: 130 } as AgentEvent;
      }
    }
    const executor = new AgentCycleExecutor(new SlowAgent());
    const harness = createService(tempRoot(), twoBotMatrix(), {
      executor: {
        runCycle: async (input) => {
          const outcome = await executor.runCycle(input);
          input.context.record(edit('r1'));
          input.context.record(check('r1', 'passed'));
          return { ...outcome, completion: { summary: 'ok' } };
        },
      },
    });
    const { run } = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x' });
    await harness.service.idle();
    const { durations } = harness.usage.metrics(run.id);
    expect(durations.context).toBeGreaterThanOrEqual(20);
    expect(durations.tool).toBeGreaterThanOrEqual(30);
    expect(durations.model).toBeGreaterThanOrEqual(40);
    expect(durations.total).toBeGreaterThanOrEqual(durations.context + durations.tool);
    await harness.close();
  });
});

describe('M05-S04 external changes invalidate evidence', () => {
  it('notices a worktree changed outside the run and requires new checks', async () => {
    const probe = vi.fn().mockResolvedValueOnce({ app: 'r2' }).mockResolvedValue({ app: 'r2' });
    const executor = new ScriptedExecutor([
      (input) => {
        input.context.record(edit('r1'));
        input.context.record(check('r1', 'passed'));
        return done();
      },
      (input) => {
        // The run confirms its changes on top of the external edit and checks again.
        input.context.record(edit('r2'));
        input.context.record(check('r2', 'passed'));
        return done('Revalidado na revisão atual');
      },
    ]);
    const harness = createService(tempRoot(), twoBotMatrix(), { executor, probe });
    const { run } = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x' });
    await harness.service.idle();
    expect(harness.store.getRun(run.id)).toMatchObject({ state: 'completed', cycleCount: 2 });
    expect(readJournal(harness.database, { runId: run.id, type: 'revision_observed' })[0]?.envelope.payload).toMatchObject({ key: 'app', revision: 'r2' });
    const verdicts = readJournal(harness.database, { runId: run.id, type: 'acceptance_evaluated' }).map((event) => event.envelope.payload?.verdict);
    expect(verdicts).toEqual(['rejected', 'accepted']);
    await harness.close();
  });

  it('invalidates a functional check when the environment configuration changes', async () => {
    const functional = (env: string): Evidence => ({
      kind: 'functional',
      criterionId: 'fluxo',
      result: 'passed',
      revision: 'r1',
      revisions: { app: 'r1', 'env:web': env },
      fingerprint: `fluxo:${env}`,
    });
    let config = 'cfg-1';
    const executor = new ScriptedExecutor([
      (input) => {
        input.context.record(edit('r1'));
        input.context.record(check('r1', 'passed'));
        input.context.record(functional('cfg-1'));
        config = 'cfg-2';
        return done();
      },
      (input) => {
        input.context.record(functional('cfg-2'));
        return done('Fluxo revalidado com a configuração nova');
      },
    ]);
    const harness = createService(tempRoot(), twoBotMatrix(), { executor, probe: async () => ({ 'env:web': config }) });
    const { run } = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x' });
    await harness.service.idle();
    expect(harness.store.getRun(run.id)).toMatchObject({ state: 'completed', cycleCount: 2 });
    expect(harness.store.criteria(run.id).find((item) => item.id === 'fluxo')?.status).toBe('satisfied');
    await harness.close();
  });

  it('never approves anything because the probe failed', async () => {
    const executor = new ScriptedExecutor([
      (input) => {
        input.context.record(edit('r1'));
        input.context.record(check('r1', 'failed'));
        return done();
      },
      () => ({ summary: 'sem novidade', traceIds: [] }),
    ]);
    const harness = createService(tempRoot(), twoBotMatrix(), { executor, probe: () => Promise.reject(new Error('runner fora')) });
    const { run } = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x' });
    await harness.service.idle();
    expect(harness.store.getRun(run.id)?.state).not.toBe('completed');
    await harness.close();
  });
});

describe('M01-S02 an intent that cannot be persisted stops the mutation', () => {
  it('blocks the run with a verifiable reason and never runs the effect', async () => {
    const effect = vi.fn(async () => 'escrito');
    const executor = new ScriptedExecutor([
      async (input) => {
        await input.context.operation({ kind: 'workspace.replace', class: 'mutate', params: { path: 'a.ts' } }, effect);
        return done();
      },
    ]);
    const harness = createService(tempRoot(), twoBotMatrix(), { executor });
    const emit = harness.journal.emit.bind(harness.journal);
    vi.spyOn(harness.journal, 'emit').mockImplementation((input) => {
      if (input.type === 'operation_intended') throw new ProgrammingError('intent_not_persisted', 'disco indisponível');
      return emit(input);
    });
    const { run } = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x' });
    await harness.service.idle();
    expect(effect).not.toHaveBeenCalled();
    expect(harness.store.getRun(run.id)).toMatchObject({ state: 'blocked', blocked: { code: 'intent_not_persisted' } });
    await harness.close();
  });
});

describe('M03-S05 pause waits for the effect in flight', () => {
  it.each(['mutate', 'publish'] as const)('applies a pause requested during a %s operation only after the effect finishes', async (klass) => {
    const gate = deferred();
    const access = twoBotMatrix();
    const executor = new ScriptedExecutor([
      async (input) => {
        await input.context.operation({ kind: klass === 'mutate' ? 'workspace.applyPatch' : 'publication.publish', class: klass, params: { n: 1 } }, async () => {
          await gate.promise;
          return 'feito';
        });
        input.context.safePoint();
        return { summary: 'nunca chega', traceIds: [] };
      },
      (input) => {
        input.context.record(edit('r1'));
        input.context.record(check('r1', 'passed'));
        // Project two publishes: its delivery criterion needs the draft of this revision.
        input.context.record({ kind: 'publication', repositoryId: 'app', sha: 'a'.repeat(40), revision: 'r1', prNumber: 3, fingerprint: 'pr-3' });
        return done();
      },
    ]);
    const harness = createService(tempRoot(), access, { executor });
    const { run } = harness.service.start(operator, { botId: 'alpha', projectId: 'two', text: 'x' });
    await until(() => harness.store.listReceipts(run.id, ['running']).length === 1);
    expect(harness.service.control(operator, run.id, 'pause').status).toBe('requested');
    await wait(50);
    // Still running: the effect is in flight and is never cut in the middle.
    expect(harness.store.getRun(run.id)?.state).toBe('running');
    gate.resolve();
    await until(() => harness.store.getRun(run.id)?.state === 'paused');
    expect(harness.store.listReceipts(run.id).map((receipt) => receipt.state)).toEqual(['succeeded']);
    expect(harness.service.control(operator, run.id, 'resume').status).toBe('applied');
    await harness.service.idle();
    expect(harness.store.getRun(run.id)?.blocked).toBeUndefined();
    expect(harness.store.getRun(run.id)?.state).toBe('completed');
    await harness.close();
  });
});

describe('M00-S04 disabling the capability', () => {
  it('pauses running work explicitly, refuses new runs and keeps results readable', async () => {
    const access = twoBotMatrix();
    const gate = deferred();
    const executor = new ScriptedExecutor([
      async (input) => {
        await gate.promise;
        input.context.record(edit('r1'));
        return { summary: 'meio', traceIds: [] };
      },
    ]);
    const harness = createService(tempRoot(), access, { executor });
    const { run } = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x' });
    await until(() => executor.inputs.length === 1);
    access.bots.set('alpha', { ...access.bot('alpha')!, programming: { ...access.bot('alpha')!.programming, enabled: false } });
    gate.resolve();
    await until(() => harness.store.getRun(run.id)?.state === 'paused');
    expect(readJournal(harness.database, { runId: run.id, type: 'run_paused' })[0]?.envelope.payload).toMatchObject({ reason: 'capability_disabled' });
    expect(() => harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'outro' })).toThrow(/não está habilitada/);
    expect(harness.service.get(operator, run.id).state).toBe('paused');
    await harness.close();
  });

  it('keeps traditional chat when programming is disabled: commands reach the agent unchanged', async () => {
    const agent = { chat: vi.fn().mockResolvedValue('resposta normal'), clearHistory: vi.fn(), transcribe: vi.fn(), remember: vi.fn(), getUsage: vi.fn() };
    const runtime = new AgentRuntime('alpha', agent);
    expect(await runtime.handle({ channel: 'cli', connectionId: 'local', conversationId: 's' }, '/tarefa corrija o bug')).toBe('resposta normal');
    expect(agent.chat).toHaveBeenCalledOnce();
  });
});

describe('M04-S03 notifications and channel control', () => {
  function channelRun() {
    const access = twoBotMatrix();
    const harness = createService(tempRoot(), access);
    const actor = channelActor('alpha', route, '42');
    const started = harness.service.start(actor, { botId: 'alpha', projectId: 'one', text: 'corrigir checkout' });
    return { access, harness, actor, run: started.run };
  }

  it('contains progress spam, isolates delivery failures from the run and honours retry-after', async () => {
    const { harness, run } = channelRun();
    let now = 1_000_000;
    const notifier = new RunNotifier(harness.journal, { now: () => now, retries: 2, retryDelayMs: 1 });
    const sent: string[] = [];
    let failures = 1;
    notifier.register('telegram', async (key, text) => {
      if (failures-- > 0) throw Object.assign(new Error('Telegram rate limit'), { name: 'RateLimited', retryAfterMs: 5 });
      sent.push(`${key}|${text}`);
    });
    await notifier.notify(run, { type: 'cycle_progress', message: 'ciclo 1' });
    await notifier.notify(run, { type: 'cycle_progress', message: 'ciclo 2' }); // within 30 s: contained
    now += 31_000;
    await notifier.notify(run, { type: 'cycle_progress', message: 'ciclo 3' });
    await notifier.notify(run, { type: 'run_completed', message: 'final' }); // final messages are never throttled
    expect(sent.map((line) => line.split('|')[1]!.split('\n')[0])).toEqual([`#${run.id.slice(4, 12)}: ciclo 1`, `#${run.id.slice(4, 12)}: ciclo 3`, expect.stringContaining(run.id.slice(4, 12))]);
    expect(sent[0]!.startsWith('123:42|')).toBe(true);
    // A channel that keeps failing records the failure and leaves the run untouched.
    notifier.register('telegram', async () => {
      throw new Error('sem rede');
    });
    await notifier.notify(run, { type: 'run_blocked', message: 'bloqueado' });
    expect(readJournal(harness.database, { runId: run.id, type: 'notification_failed' })).toHaveLength(1);
    expect(harness.store.getRun(run.id)?.state).toBe('queued');
    await harness.close();
  });

  it('pauses, resumes and cancels from the conversation, asking which run when ambiguous', async () => {
    const { access, harness, actor, run } = channelRun();
    const queries = new RunQueries(harness.store, access, harness.journal, harness.usage);
    const commands = new ChannelCommands({ botId: 'alpha', service: harness.service, queries, access, journal: harness.journal });
    const short = run.id.slice(4, 12);
    expect(commands.handle(route, '/pause')).toMatch(/Pausa|pausa|aplicad|solicitad/i);
    expect(commands.handle(route, `/resume ${short} retomando depois de revisar`)).not.toMatch(/não encontrado/);
    const second = harness.service.start(actor, { botId: 'alpha', projectId: 'one', text: 'outro pedido' }).run;
    expect(commands.handle(route, '/cancel')).toMatch(/Há 2 trabalhos ativos; informe qual/);
    expect(commands.handle(route, `/cancel ${second.id.slice(4, 12)}`)).toMatch(/cancel/i);
    // Another conversation of the same bot cannot see or control them.
    expect(commands.handle({ ...route, conversationId: '99' }, `/pause ${short}`)).toBe('Trabalho não encontrado nesta conversa.');
    await harness.close();
  });
});

describe('M03-S02 new request versus clarification in chat', () => {
  it('asks for confirmation before starting a second run while one is active in the conversation', async () => {
    const access = twoBotMatrix();
    const harness = createService(tempRoot(), access);
    const queries = new RunQueries(harness.store, access, harness.journal, harness.usage);
    const [start] = programmingChatTools({ botId: 'alpha', service: harness.service, queries, access, journal: harness.journal });
    const context = { threadId: JSON.stringify(['alpha', route.channel, route.connectionId, route.conversationId]), toolCallId: 'call-1' };
    const call = async (args: Record<string, unknown>, toolCallId: string) =>
      JSON.parse(String(await start!.execute(args, new AbortController().signal, undefined, { ...context, toolCallId } as never))) as Record<string, unknown>;
    const first = await call({ projectId: 'one', request: 'Corrija o checkout' }, 'c1');
    expect(first).toMatchObject({ state: 'queued', runId: expect.stringMatching(/^run-/) });
    const ambiguous = await call({ projectId: 'one', request: 'e também o frete' }, 'c2');
    expect(ambiguous).toMatchObject({ needsConfirmation: true, activeRuns: [{ runId: first.runId }] });
    expect(harness.store.listRuns({ botId: 'alpha' }).items).toHaveLength(1);
    const confirmed = await call({ projectId: 'one', request: 'Novo: refatorar o frete', confirmNew: true }, 'c3');
    expect(confirmed.runId).not.toBe(first.runId);
    await harness.close();
  });
});
