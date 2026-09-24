/* eslint-disable @typescript-eslint/no-explicit-any -- journal payloads are untyped JSON */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '@oinko/core';
import { WorkspaceStore } from '@oinko/workspaces';
import { AgentRuntime } from '@oinko/agent-runtime';
import { AgentCycleExecutor, PROGRAMMING_RUN_INSTRUCTIONS, readJournal, type RunExecutor } from '@oinko/agent-runtime/programming';
import { BotStore } from '../src/store.js';
import { openProgramming } from '../src/programming/runtime.js';
import { programmingRunTools } from '../src/programming/run-tools.js';
import { LocalRunner, gitRepo, lastResult, scriptedProvider, type ScriptStep } from './helpers/programming.js';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

const BUG = {
  'package.json': JSON.stringify({ name: 'shop', scripts: { test: 'node sum.test.cjs' } }),
  'sum.cjs': 'module.exports = (a, b) => a - b;\n',
  'sum.test.cjs': "const sum = require('./sum.cjs');\nif (sum(2, 3) !== 5) { console.error('esperado 5, recebido ' + sum(2, 3)); process.exit(1); }\nconsole.log('ok');\n",
  'AGENTS.md': 'Rode o teste com node sum.test.cjs.',
};

/** Model behaviour for the bug: inspect, prove with a failing test, fix, re-test, diff, complete. */
function bugScript(): (messages: any[], call: number) => ScriptStep {
  const steps: ((messages: any[]) => ScriptStep)[] = [
    () => ({ tool: 'workspace_context', args: { targets: ['sum.cjs'] } }),
    () => ({ tool: 'workspace_check', args: { kind: 'test', command: 'node sum.test.cjs' } }),
    () => ({ tool: 'workspace_search', args: { query: 'a - b' } }),
    () => ({ tool: 'workspace_read_range', args: { path: 'sum.cjs' } }),
    (messages) => ({ tool: 'workspace_replace', args: { path: 'sum.cjs', expectedHash: lastResult(messages).hash, oldText: 'a - b', newText: 'a + b' } }),
    () => ({ tool: 'workspace_check', args: { kind: 'test', command: 'node sum.test.cjs' } }),
    () => ({ tool: 'workspace_diff', args: {} }),
    () => ({ tool: 'programming_complete', args: { summary: 'Soma corrigida; teste passando na revisão final.' } }),
    () => ({ text: 'Concluí: a soma usa +, o teste falhava antes e passa agora.' }),
  ];
  let index = 0;
  return (messages) => (steps[index] ? steps[index++]!(messages) : { text: 'Aguardando avaliação.' });
}

/** A runner process started before the workspace extensions existed: only base commands. */
class OutdatedRunner extends LocalRunner {
  readonly refused: string[] = [];
  override async command<T>(command: any, options: { correlation?: any } = {}): Promise<T> {
    if (['state', 'createTask', 'shell', 'readFile', 'writeFile', 'jobLogs'].includes(command.action)) return super.command<T>(command, options);
    this.refused.push(command.action);
    throw Object.assign(new Error(`O gerenciador de ambientes em execução (pid 4242) é de uma versão anterior e não conhece a operação "${command.action}". Reinicie o gerenciador para carregar a versão atual.`), {
      code: 'runner_outdated',
      details: { action: command.action, pid: 4242 },
    });
  }
}

function setup(options: { maxIterations?: number; script?: (messages: any[], call: number) => ScriptStep; runner?: (worktree: string) => LocalRunner } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oinko-programming-run-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const bots = new BotStore(root);
  bots.save(
    {
      id: 'alpha',
      name: 'Alpha',
      model: 'main-model',
      systemPrompt: 'Você é um bot de programação.',
      programmingPolicy: { enabled: true, cycle: { maxIterations: options.maxIterations ?? 20, noProgressLimit: 3, commandTimeoutSeconds: 60 } },
    },
    { apiKey: 'sk-test-key-0123456789abcdef' },
    0,
  );
  const workspaces = new WorkspaceStore(root);
  workspaces.saveProject({ id: 'shop', name: 'Shop', repositories: [{ id: 'app', source: 'https://example.com/shop.git' }], allowedBotIds: ['alpha'] }, 0);
  workspaces.saveTask({ id: 'fix', projectId: 'shop', name: 'Fix', branch: 'task/fix', state: 'ready' }, 0);
  workspaces.close();
  const repo = gitRepo(BUG);
  cleanup.push(repo.cleanup);
  const runner = options.runner?.(repo.worktree) ?? new LocalRunner(repo.worktree);
  const provider = scriptedProvider(options.script ?? bugScript());
  const cycles: { current?: RunExecutor } = {};
  const programming = openProgramming({
    root,
    producer: 'runtime:alpha',
    executeFor: 'alpha',
    bots,
    runner,
    executor: { runCycle: (input) => cycles.current!.runCycle(input) },
    secrets: () => ['sk-test-key-0123456789abcdef'],
  });
  const telemetryDbPath = bots.runtime('alpha').paths.telemetryDbPath;
  const agent = Agent.create({
    apiKey: 'sk-test-key-0123456789abcdef',
    model: 'main-model',
    systemPrompt: `Você é um bot de programação.${PROGRAMMING_RUN_INSTRUCTIONS}`,
    fetch: provider.fetch,
    memory: { enabled: false },
    knowledge: { enabled: false },
    telemetry: { enabled: true, dbPath: telemetryDbPath, app: 'alpha', capturePayloads: 'full' },
    logLevel: 'silent',
  });
  for (const tool of programmingRunTools({ runner, service: programming.service, pollMs: 20 })) agent.addTool(tool);
  cycles.current = new AgentCycleExecutor(agent);
  cleanup.push(async () => {
    await programming.close();
    await agent.destroy();
    bots.close();
  });
  return { root, bots, repo, runner, provider, programming, agent, telemetryDbPath };
}
const operator = { kind: 'operator' as const, id: 'test' };

describe('programming run with the real agent loop and simulated provider', () => {
  it('fixes a bug proven by a failing test and completes only on evidence of the final revision', async () => {
    const context = setup();
    const { service, store, database } = context.programming;
    const started = service.start(operator, { botId: 'alpha', projectId: 'shop', taskId: 'fix', text: 'Corrija a função sum.' });
    service.kick();
    await service.idle();
    const run = store.getRun(started.run.id)!;
    expect(run).toMatchObject({ state: 'completed', finalOutcome: { delivery: 'technical' } });
    expect(readFileSync(join(context.repo.worktree, 'sum.cjs'), 'utf8')).toContain('a + b');
    expect(store.criteria(run.id).map((criterion) => [criterion.id, criterion.status])).toEqual([
      ['changes', 'satisfied'],
      ['checks', 'satisfied'],
    ]);
    const receipts = store.listReceipts(run.id);
    expect(receipts.map((receipt) => [receipt.kind, receipt.state])).toEqual([
      ['workspace.check', 'succeeded'],
      ['workspace.replace', 'succeeded'],
      ['workspace.check', 'succeeded'],
    ]);
    // The runner saw correlation for every call of the run.
    expect(context.runner.calls.filter((call) => call.action !== 'state').every((call: any) => call.correlation?.runId === run.id)).toBe(true);
    const types = readJournal(database, { runId: run.id }).map((event) => event.envelope.type);
    for (const type of ['run_created', 'policy_resolved', 'run_dispatched', 'cycle_started', 'project_instructions_resolved', 'project_commands_discovered', 'check_started', 'check_finished', 'workspace_search', 'workspace_read', 'workspace_edit_intended', 'workspace_edit_finished', 'git_diff_captured', 'artifact_created', 'progress_assessed', 'acceptance_evaluated', 'usage_reported', 'run_metrics_updated', 'run_completed'])
      expect(types, type).toContain(type);
    const checks = readJournal(database, { runId: run.id, type: 'check_finished' }).map((event) => event.envelope.payload?.result);
    expect(checks).toEqual(['failed', 'passed']);
    // LLM executions are correlated with the run and step.
    const telemetry = new DatabaseSync(context.telemetryDbPath, { readOnly: true });
    const correlations = telemetry.prepare('SELECT correlation_json FROM executions').all() as { correlation_json: string }[];
    expect(correlations.map((row) => JSON.parse(row.correlation_json).runId)).toEqual([run.id]);
    telemetry.close();
    // Provider usage is attributed to the run by call id, with confirmed cost where reported.
    const metrics = context.programming.usage.metrics(run.id);
    expect(metrics.calls).toBe(context.provider.requests.length);
    expect(metrics.tokens.byRole.main).toBeGreaterThan(0);
    expect(metrics.cost.pendingCalls + metrics.cost.unavailableCalls + metrics.cost.confirmedCalls).toBe(metrics.calls);
    // Delivered to the bot telemetry repository without duplicates.
    await context.programming.deliverer.flush();
    await context.programming.deliverer.flush();
    const delivered = new DatabaseSync(context.telemetryDbPath, { readOnly: true });
    const counts = delivered.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT event_id) AS d FROM telemetry_events WHERE run_id = ?').get(run.id) as { n: number; d: number };
    delivered.close();
    expect(counts.n).toBeGreaterThan(10);
    expect(counts.n).toBe(counts.d);
    // Planted API key never persisted in the run database.
    expect(readFileSync(join(context.root, '.harness/programming.db')).toString('latin1')).not.toContain('sk-test-key-0123456789abcdef');
  }, 60_000);

  it('continues across cycles when the per-cycle iteration limit is small', async () => {
    const context = setup({ maxIterations: 3 });
    const { service, store } = context.programming;
    const id = service.start(operator, { botId: 'alpha', projectId: 'shop', taskId: 'fix', text: 'Corrija a função sum.' }).run.id;
    service.kick();
    await service.idle();
    const run = store.getRun(id)!;
    expect(run.state).toBe('completed');
    expect(run.cycleCount).toBeGreaterThan(1);
    expect(store.listSteps(id).filter((step) => step.kind === 'cycle').length).toBe(run.cycleCount);
  }, 60_000);

  it('rejects a completion claimed before the evidence exists and keeps working', async () => {
    const steps: ((messages: any[]) => ScriptStep)[] = [
      () => ({ tool: 'programming_complete', args: { summary: 'Já está pronto.' } }),
      () => ({ text: 'Pronto!' }),
    ];
    const bug = bugScript();
    let index = 0;
    const context = setup({ script: (messages, call) => (steps[index] ? steps[index++]!(messages) : bug(messages, call)) });
    const { service, store, database } = context.programming;
    const id = service.start(operator, { botId: 'alpha', projectId: 'shop', taskId: 'fix', text: 'Corrija a função sum.' }).run.id;
    service.kick();
    await service.idle();
    const verdicts = readJournal(database, { runId: id, type: 'acceptance_evaluated' }).map((event) => event.envelope.payload?.verdict);
    expect(verdicts).toEqual(['rejected', 'accepted']);
    expect(store.getRun(id)?.state).toBe('completed');
  }, 60_000);

  it('controls work from a channel without waiting for the agent and notifies the conversation', async () => {
    const context = setup();
    const { service, commands, notifier } = context.programming;
    const runtime = new AgentRuntime('alpha', { chat: async () => 'resposta', transcribe: async () => '', clearHistory: () => {}, remember: async () => 'ok', getUsage: () => ({}) } as any, commands);
    const received: string[] = [];
    notifier.register('cli', async (key, text) => {
      received.push(`${key}|${text}`);
    });
    const route = { channel: 'cli', connectionId: 'local', conversationId: 's1' };
    const accepted = await runtime.handle(route, '/tarefa Corrija a função sum.', undefined, { idempotencyKey: 'cli:1' });
    expect(accepted).toMatch(/Trabalho registrado: #[a-f0-9]{8} \(shop\)/);
    expect(await runtime.handle(route, '/tarefa Corrija a função sum.', undefined, { idempotencyKey: 'cli:1' })).toMatch(/Pedido já recebido/);
    expect(await runtime.handle({ ...route, conversationId: 'outra' }, '/status')).toMatch(/Nenhum trabalho ativo/);
    const status = await runtime.handle(route, '/status');
    expect(status).toMatch(/#[a-f0-9]{8} (na fila|em execução)/);
    const [run] = context.programming.store.listRuns({ botId: 'alpha' }).items;
    // The run lacks a task: attach the existing one so the tools can work.
    service.attachTask(run!.id, 'fix');
    service.kick();
    await service.idle();
    expect(context.programming.store.getRun(run!.id)?.state).toBe('completed');
    expect(await runtime.handle(route, `/status ${run!.id.slice(4, 12)}`)).toMatch(/concluído/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received.some((line) => line.startsWith('local:s1|') && line.includes('concluído'))).toBe(true);
    expect(await runtime.handle(route, `/cancel ${run!.id.slice(4, 12)}`)).toMatch(/já encerrado/);
  }, 60_000);

  it('counts a change made through workspace_exec as an edit of the run', async () => {
    const steps: ScriptStep[] = [
      { tool: 'workspace_exec', args: { command: 'cat sum.cjs' } },
      { tool: 'workspace_exec', args: { command: "printf 'module.exports = (a, b) => a + b;\\n' > sum.cjs" } },
      { tool: 'workspace_check', args: { kind: 'test', command: 'node sum.test.cjs' } },
      { tool: 'programming_complete', args: { summary: 'Soma corrigida pelo terminal; teste passando.' } },
      { text: 'Concluí.' },
    ];
    let index = 0;
    const context = setup({ script: () => steps[index++] ?? { text: 'Aguardando avaliação.' } });
    const { service, store } = context.programming;
    const id = service.start(operator, { botId: 'alpha', projectId: 'shop', taskId: 'fix', text: 'Corrija a função sum.' }).run.id;
    service.kick();
    await service.idle();
    expect(store.getRun(id)).toMatchObject({ state: 'completed' });
    expect(store.criteria(id).map((criterion) => [criterion.id, criterion.status])).toEqual([
      ['changes', 'satisfied'],
      ['checks', 'satisfied'],
    ]);
    const receipts = store.listReceipts(id);
    expect(receipts.map((receipt) => receipt.kind)).toEqual(['workspace.exec', 'workspace.exec', 'workspace.check']);
    // Only the command that changed the worktree is an edit, with the files it changed.
    const edits = store.evidence<any>(id).map((item) => item.value).filter((item) => item.kind === 'edit');
    expect(edits).toEqual([expect.objectContaining({ repositoryId: 'app', paths: ['sum.cjs'], operationId: receipts[1]!.operationId })]);
  }, 60_000);

  it('blocks the run naming the fix when the environment runner is older than the tools, without falling back to the shell', async () => {
    const steps: ScriptStep[] = [
      { tool: 'workspace_read_range', args: { path: 'sum.cjs' } },
      { tool: 'workspace_exec', args: { command: 'cat sum.cjs' } },
      { text: 'As ferramentas do ambiente não responderam.' },
    ];
    let index = 0;
    let runner: OutdatedRunner | undefined;
    const context = setup({ script: () => steps[index++] ?? { text: 'Parado.' }, runner: (worktree) => (runner = new OutdatedRunner(worktree)) });
    const { service, store } = context.programming;
    const id = service.start(operator, { botId: 'alpha', projectId: 'shop', taskId: 'fix', text: 'Corrija a função sum.' }).run.id;
    service.kick();
    await service.idle();
    const run = store.getRun(id)!;
    expect(run.state).toBe('blocked');
    expect(run.blocked).toMatchObject({ code: 'runner_outdated', message: expect.stringMatching(/versão anterior[\s\S]*Reinicie/) });
    // After the first refusal no tool reaches the runner: no shell fallback, no retries.
    expect(runner!.refused).toEqual(['readRange']);
    expect(runner!.calls.map((call) => call.action)).not.toContain('shell');
    const results = context.provider.requests.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => JSON.parse(String(message.content)));
    expect(results.map((result) => result.error?.code)).toEqual(['runner_outdated', 'runner_outdated']);
    expect(store.listReceipts(id)).toEqual([]);
  }, 60_000);
});
