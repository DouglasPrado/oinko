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

function setup(options: { maxIterations?: number; script?: (messages: any[], call: number) => ScriptStep; runner?: (worktree: string) => LocalRunner; files?: Record<string, string> } = {}) {
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
  const repo = gitRepo(options.files ?? BUG);
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

  it('never leaves an edit uncertain when the runner refused it before running, nor accepts a hash it did not return', async () => {
    class RefusingRunner extends LocalRunner {
      override async command<T>(command: any, options: { correlation?: any } = {}): Promise<T> {
        if (command.action === 'applyPatch')
          throw Object.assign(new Error('Pedido inválido para o gerenciador: command.edits.0.path: Invalid'), { code: 'invalid_request' });
        return super.command<T>(command, options);
      }
    }
    const readHash = (messages: any[]) => JSON.parse(String(messages.find((message) => message.role === 'tool').content)).hash;
    const steps: ((messages: any[]) => ScriptStep)[] = [
      () => ({ tool: 'workspace_read_range', args: { path: 'sum.cjs' } }),
      // A hash the model computed itself (md5 from the shell) is refused by the tool.
      () => ({ tool: 'workspace_replace', args: { path: 'sum.cjs', expectedHash: 'e38bf38f29bca5d4e89a8e8f3c12c1f1', oldText: 'a - b', newText: 'a + b' } }),
      (messages) => ({ tool: 'workspace_patch', args: { edits: [{ action: 'replace', path: 'sum.cjs', expectedHash: readHash(messages), oldText: 'a - b', newText: 'a + b' }] } }),
      () => ({ text: 'Não consegui aplicar.' }),
    ];
    let index = 0;
    const context = setup({ script: (messages) => (steps[index] ? steps[index++]!(messages) : { text: 'Parado.' }), runner: (worktree) => new RefusingRunner(worktree) });
    const { service, store } = context.programming;
    const id = service.start(operator, { botId: 'alpha', projectId: 'shop', taskId: 'fix', text: 'Corrija a função sum.' }).run.id;
    service.kick();
    await service.idle();
    const results = context.provider.requests[3]!.messages.filter((message) => message.role === 'tool').map((message) => String(message.content));
    expect(results[1]).toMatch(/sha256:… devolvido por workspace_read_range/);
    expect(JSON.parse(results[2]!).error.code).toBe('invalid_request');
    // The refused hash never became an operation; the refused patch is a known failure.
    expect(store.listReceipts(id).map((receipt) => [receipt.kind, receipt.state])).toEqual([['workspace.applyPatch', 'failed']]);
  }, 60_000);

  it('prepares the run task on its own branch whatever branch the model asks for, and retries after a failure', async () => {
    const steps: ((messages: any[]) => ScriptStep)[] = [
      // minimax-m3 asked for the base branch, then kept retrying with other names.
      () => ({ tool: 'workspace_prepare_task', args: { branch: 'main' } }),
      () => ({ tool: 'workspace_read_range', args: { path: 'sum.cjs' } }),
      (messages) => ({ tool: 'workspace_replace', args: { path: 'sum.cjs', expectedHash: lastResult(messages).hash, oldText: 'a - b', newText: 'a + b' } }),
      () => ({ tool: 'workspace_check', args: { kind: 'test', command: 'node sum.test.cjs' } }),
      () => ({ tool: 'programming_complete', args: { summary: 'Soma corrigida.' } }),
      () => ({ text: 'Concluí.' }),
    ];
    let index = 0;
    const context = setup({ script: (messages) => (steps[index] ? steps[index++]!(messages) : { text: 'Parado.' }) });
    const { service, store } = context.programming;
    const id = service.start(operator, { botId: 'alpha', projectId: 'shop', text: 'Corrija a função sum.' }).run.id;
    service.kick();
    await service.idle();
    const run = store.getRun(id)!;
    expect(run.state).toBe('completed');
    expect(run.taskId).toBe(`run-${id.slice(4, 12)}`);
    const prepared = store.listReceipts(id).filter((receipt) => receipt.kind === 'workspace.createTask');
    expect(prepared.map((receipt) => [receipt.state, receipt.intent.branch])).toEqual([['succeeded', `oinko/${id.slice(4, 12)}`]]);
  }, 60_000);

  it('never gets stuck on a task ID a failed attempt left behind, and never leaves it uncertain', async () => {
    const steps: ((messages: any[]) => ScriptStep)[] = [
      () => ({ tool: 'workspace_prepare_task', args: {} }),
      () => ({ tool: 'workspace_read_range', args: { path: 'sum.cjs' } }),
      (messages) => ({ tool: 'workspace_replace', args: { path: 'sum.cjs', expectedHash: lastResult(messages).hash, oldText: 'a - b', newText: 'a + b' } }),
      () => ({ tool: 'workspace_check', args: { kind: 'test', command: 'node sum.test.cjs' } }),
      () => ({ tool: 'programming_complete', args: { summary: 'Soma corrigida.' } }),
      () => ({ text: 'Concluí.' }),
    ];
    let index = 0;
    const context = setup({ script: (messages) => (steps[index] ? steps[index++]!(messages) : { text: 'Parado.' }) });
    const { service, store } = context.programming;
    const id = service.start(operator, { botId: 'alpha', projectId: 'shop', text: 'Corrija a função sum.' }).run.id;
    const short = id.slice(4, 12);
    // An earlier attempt (older version) registered this run's task ID on another branch and failed.
    await context.runner.command({ action: 'createTask', definition: { id: `run-${short}`, projectId: 'shop', name: 'x', branch: 'main' } });
    service.kick();
    await service.idle();
    expect(store.getRun(id)).toMatchObject({ state: 'completed', taskId: `run-${short}-2` });
    expect(store.listReceipts(id).filter((receipt) => receipt.state === 'uncertain')).toEqual([]);
  }, 60_000);

  it('checks the package of the files the run changed when no cwd is given, not the whole repository', async () => {
    const MONOREPO = {
      'package.json': JSON.stringify({ name: 'root', private: true, scripts: { test: 'node -e "process.exit(3)"' } }),
      'packages/app/package.json': JSON.stringify({ name: 'app', scripts: { test: 'node sum.test.cjs' } }),
      'packages/app/sum.cjs': 'module.exports = (a, b) => a - b;\n',
      'packages/app/sum.test.cjs': BUG['sum.test.cjs'],
    };
    const steps: ((messages: any[]) => ScriptStep)[] = [
      () => ({ tool: 'workspace_read_range', args: { path: 'packages/app/sum.cjs' } }),
      (messages) => ({ tool: 'workspace_replace', args: { path: 'packages/app/sum.cjs', expectedHash: lastResult(messages).hash, oldText: 'a - b', newText: 'a + b' } }),
      () => ({ text: 'Editei; testo no próximo ciclo.' }),
      () => ({ tool: 'workspace_check', args: { kind: 'test' } }),
      () => ({ tool: 'programming_complete', args: { summary: 'Soma corrigida.' } }),
      () => ({ text: 'Concluí.' }),
    ];
    let index = 0;
    const context = setup({ files: MONOREPO, script: (messages) => (steps[index] ? steps[index++]!(messages) : { text: 'Parado.' }) });
    const { service, store } = context.programming;
    const id = service.start(operator, { botId: 'alpha', projectId: 'shop', taskId: 'fix', text: 'Corrija a função sum.' }).run.id;
    service.kick();
    await service.idle();
    const check = context.provider.requests.flatMap((request) => request.messages).filter((message) => message.role === 'tool').map((message) => { try { return JSON.parse(String(message.content)); } catch { return {}; } }).find((result) => result.kind === 'test' || result.cwd);
    // The edit was in an earlier cycle: the package still comes from the run's history.
    expect(check).toMatchObject({ cwd: 'packages/app', result: 'passed' });
    expect(store.getRun(id)?.state).toBe('completed');
  }, 60_000);

  it('records the delivered diff when a completion is accepted even if the agent never asked for it', async () => {
    const steps: ((messages: any[]) => ScriptStep)[] = [
      () => ({ tool: 'workspace_read_range', args: { path: 'sum.cjs' } }),
      (messages) => ({ tool: 'workspace_replace', args: { path: 'sum.cjs', expectedHash: lastResult(messages).hash, oldText: 'a - b', newText: 'a + b' } }),
      () => ({ tool: 'workspace_check', args: { kind: 'test', command: 'node sum.test.cjs' } }),
      () => ({ tool: 'programming_complete', args: { summary: 'Soma corrigida.' } }),
      () => ({ text: 'Concluí.' }),
    ];
    let index = 0;
    const context = setup({ script: (messages) => (steps[index] ? steps[index++]!(messages) : { text: 'Parado.' }) });
    const { service, store } = context.programming;
    const id = service.start(operator, { botId: 'alpha', projectId: 'shop', taskId: 'fix', text: 'Corrija a função sum.' }).run.id;
    service.kick();
    await service.idle();
    expect(store.getRun(id)?.state).toBe('completed');
    const diffs = context.programming.artifacts.listForRun(id).filter((artifact) => artifact.type === 'diff');
    expect(diffs).toHaveLength(1);
    expect(context.programming.artifacts.read(operator, diffs[0]!.id).content.toString('utf8')).toContain('+module.exports = (a, b) => a + b;');
  }, 60_000);

  it('does not record the diff twice when the agent already captured the final one', async () => {
    const context = setup();
    const { service } = context.programming;
    const id = service.start(operator, { botId: 'alpha', projectId: 'shop', taskId: 'fix', text: 'Corrija a função sum.' }).run.id;
    service.kick();
    await service.idle();
    expect(context.programming.artifacts.listForRun(id).filter((artifact) => artifact.type === 'diff')).toHaveLength(1);
  }, 60_000);

  it('accepts the input shapes a weaker model sends (absolute paths, strings for booleans and numbers, nested plan steps)', async () => {
    const readHash = (messages: any[]) => JSON.parse(String(messages.find((message) => message.role === 'tool').content)).hash;
    const steps: ((messages: any[]) => ScriptStep)[] = [
      // Shapes seen from minimax-m3 in a real run.
      () => ({ tool: 'workspace_read_range', args: { path: '/workspace/tasks/fix/app/sum.cjs', startLine: '1' } }),
      (messages) => ({ tool: 'workspace_patch', args: { edits: [{ action: 'replace', path: './sum.cjs', expectedHash: readHash(messages), oldText: 'a - b', newText: 'a + b', replaceAll: 'false' }] } }),
      () => ({ tool: 'programming_update_plan', args: { steps: [{ item: { item: 'Corrigir a soma' } }, 'Rodar o teste', [{ text: 'Concluir' }]] } }),
      () => ({ tool: 'workspace_check', args: { kind: 'test', command: 'node sum.test.cjs', cwd: '/workspace/tasks/fix/app', timeoutSeconds: '60' } }),
      () => ({ tool: 'programming_complete', args: { summary: 'Soma corrigida.' } }),
      () => ({ text: 'Concluí.' }),
    ];
    let index = 0;
    const context = setup({ script: (messages) => (steps[index] ? steps[index++]!(messages) : { text: 'Parado.' }) });
    const { service, store } = context.programming;
    const id = service.start(operator, { botId: 'alpha', projectId: 'shop', taskId: 'fix', text: 'Corrija a função sum.' }).run.id;
    service.kick();
    await service.idle();
    const results = context.provider.requests.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => String(message.content));
    for (const result of results) expect(result).not.toMatch(/"error"|Validation error/);
    expect(store.getRun(id)?.state).toBe('completed');
    expect(store.planRevisions(id).at(-1)?.plan).toEqual(['Corrigir a soma', 'Rodar o teste', 'Concluir']);
  }, 60_000);

  it('keeps an over-long question instead of refusing it', async () => {
    const steps: ScriptStep[] = [{ tool: 'programming_request_input', args: { question: `Qual tema padrão? ${'contexto '.repeat(400)}` } }, { text: 'Aguardando.' }];
    let index = 0;
    const context = setup({ script: () => steps[index++] ?? { text: 'Parado.' } });
    const { service, store } = context.programming;
    const id = service.start(operator, { botId: 'alpha', projectId: 'shop', taskId: 'fix', text: 'Tema escuro.' }).run.id;
    service.kick();
    await service.idle();
    const run = store.getRun(id)!;
    expect(run.blocked).toMatchObject({ code: 'needs_input', needs: expect.stringMatching(/^Qual tema padrão\?/) });
    expect(run.blocked!.needs!.length).toBeLessThanOrEqual(2000);
  }, 60_000);

  it('still runs a shell command when the snapshot around it fails, so the agent can free space', async () => {
    class FullDiskRunner extends LocalRunner {
      override async command<T>(command: any, options: { correlation?: any } = {}): Promise<T> {
        if (command.action === 'gitSnapshot') throw new Error('fatal: Out of diskspace');
        return super.command<T>(command, options);
      }
    }
    const steps: ScriptStep[] = [{ tool: 'workspace_exec', args: { command: 'echo liberando espaço' } }, { text: 'Liberei.' }];
    let index = 0;
    const context = setup({ script: () => steps[index++] ?? { text: 'Parado.' }, runner: (worktree) => new FullDiskRunner(worktree) });
    const { service, store } = context.programming;
    const id = service.start(operator, { botId: 'alpha', projectId: 'shop', taskId: 'fix', text: 'Libere espaço.' }).run.id;
    service.kick();
    await service.idle();
    const result = JSON.parse(String(context.provider.requests[1]!.messages.filter((message) => message.role === 'tool').at(-1)!.content));
    expect(result).toMatchObject({ exitCode: 0, stdout: expect.stringContaining('liberando espaço') });
    expect(store.listReceipts(id).map((receipt) => [receipt.kind, receipt.state])).toEqual([['workspace.exec', 'succeeded']]);
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
