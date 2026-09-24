/* eslint-disable @typescript-eslint/no-explicit-any -- journal payloads are untyped JSON */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '@oinko/core';
import { WorkspaceStore } from '@oinko/workspaces';
import { AgentCycleExecutor, PROGRAMMING_RUN_INSTRUCTIONS, TELEMETRY_CATALOG, channelActor, readJournal, type Actor, type Evidence, type RunExecutor } from '@oinko/agent-runtime/programming';
import { BotStore } from '../src/store.js';
import { openProgramming } from '../src/programming/runtime.js';
import { programmingRunTools } from '../src/programming/run-tools.js';
import { DELIVERY_TOOL_NAMES, createDeliveryTools } from '../src/programming/delivery-tools.js';
import { RunnerReconciler } from '../src/programming/reconciler.js';
import { gitRepo, lastResult, scriptedProvider, type ScriptStep } from './helpers/programming.js';
import { DeliveryRunner } from './helpers/delivery.js';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

const APP = {
  'package.json': JSON.stringify({ name: 'shop', scripts: { test: 'node check.cjs' } }),
  'page.txt': 'Formulário de entrega\n',
  'check.cjs': "const fs = require('fs');\nif (!fs.readFileSync('page.txt', 'utf8').includes('validate-cep')) { console.error('sem validação'); process.exit(1); }\n",
};
const PREVIEW = 'http://fix.shop.preview.test/checkout';

type Step = (messages: any[]) => ScriptStep;
function script(steps: Step[]): (messages: any[], call: number) => ScriptStep {
  let index = 0;
  return (messages) => (steps[index] ? steps[index++]!(messages) : { text: 'Aguardando avaliação.' });
}
const fix: Step[] = [
  () => ({ tool: 'workspace_read_range', args: { path: 'page.txt' } }),
  (messages) => ({ tool: 'workspace_replace', args: { path: 'page.txt', expectedHash: lastResult(messages).hash, oldText: 'Formulário de entrega', newText: 'Formulário de entrega validate-cep' } }),
  () => ({ tool: 'workspace_check', args: { kind: 'test', command: 'node check.cjs' } }),
];
const validate: Step[] = [
  () => ({ tool: 'workspace_preview', args: {} }),
  () => ({ tool: 'browser_open', args: { kind: 'test' } }),
  () => ({ tool: 'browser_navigate', args: { url: PREVIEW } }),
  () => ({ tool: 'browser_navigate', args: { url: 'http://169.254.169.254/latest/meta-data' } }),
  () => ({ tool: 'browser_snapshot', args: {} }),
  () => ({ tool: 'browser_click', args: { ref: 'e1' } }),
  () => ({ tool: 'functional_check', args: { criterionId: 'checkout_cep', description: 'Checkout mostra erro de CEP inválido', expect: { text: ['Erro: CEP inválido'] } } }),
];

function setup(options: { steps: Step[]; publish?: boolean; browser?: boolean; projectBrowser?: boolean }) {
  let delivery: ReturnType<typeof createDeliveryTools> | undefined;
  const root = mkdtempSync(join(tmpdir(), 'oinko-delivery-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const bots = new BotStore(root);
  bots.save(
    {
      id: 'alpha',
      name: 'Alpha',
      model: 'main-model',
      systemPrompt: 'Você é um bot de programação.',
      programmingPolicy: {
        enabled: true,
        cycle: { maxIterations: 30, noProgressLimit: 3, commandTimeoutSeconds: 60 },
        capabilities: { browser: options.browser ?? true, publication: options.publish ?? true },
      },
    },
    { apiKey: 'sk-test-key-0123456789abcdef' },
    0,
  );
  const workspaces = new WorkspaceStore(root);
  workspaces.saveProject(
    {
      id: 'shop',
      name: 'Shop',
      repositories: [{ id: 'app', source: 'https://example.com/shop.git' }],
      allowedBotIds: ['alpha'],
      programming: {
        browser: { enabled: options.projectBrowser ?? true },
        github: { repositories: [{ repositoryId: 'app', owner: 'acme', name: 'shop' }] },
        publisherBotIds: ['alpha'],
      },
    },
    0,
  );
  workspaces.saveTask({ id: 'fix', projectId: 'shop', name: 'Fix', branch: 'task/fix', state: 'ready' }, 0);
  workspaces.close();
  const repo = gitRepo(APP);
  cleanup.push(repo.cleanup);
  const runner = new DeliveryRunner(repo.worktree);
  const provider = scriptedProvider(script(options.steps));
  const cycles: { current?: RunExecutor } = {};
  const programming = openProgramming({
    root,
    producer: 'runtime:alpha',
    executeFor: 'alpha',
    bots,
    runner,
    executor: { runCycle: (input) => cycles.current!.runCycle(input) },
    secrets: () => ['sk-test-key-0123456789abcdef'],
    dashboardUrl: 'http://127.0.0.1:3000/',
    probe: (run, known) => delivery?.probe(run, known) ?? Promise.resolve(undefined),
    onRunFinished: (run) => void delivery?.closeRun(run.id, run.state),
  });
  const agent = Agent.create({
    apiKey: 'sk-test-key-0123456789abcdef',
    model: 'main-model',
    systemPrompt: `Você é um bot de programação.${PROGRAMMING_RUN_INSTRUCTIONS}`,
    fetch: provider.fetch,
    memory: { enabled: false },
    knowledge: { enabled: false },
    logLevel: 'silent',
  });
  const tools = [
    ...programmingRunTools({ runner, service: programming.service, pollMs: 10 }),
    ...(delivery = createDeliveryTools({
      runner,
      access: programming.access,
      service: programming.service,
      evidence: (runId) => programming.store.evidence<Evidence>(runId).map((item) => item.value),
      journal: programming.journal,
      capabilities: { browser: options.browser ?? true, publication: options.publish ?? true },
      onSessionClosed: ({ runId, sessionId, reason }) => programming.journal.record('browser_session_closed', { botId: 'alpha', runId }, { sessionId, reason: `run_${reason}` }, 'succeeded'),
      pollMs: 10,
      ciPollMs: 10,
    })).tools,
  ];
  for (const tool of tools) agent.addTool(tool);
  cycles.current = new AgentCycleExecutor(agent);
  cleanup.push(async () => {
    await programming.close();
    await agent.destroy();
    bots.close();
  });
  return { root, repo, runner, provider, programming, tools };
}
const operator = { kind: 'operator' as const, id: 'test' };

async function runOnce(context: ReturnType<typeof setup>, text = 'Valide o CEP no checkout.', mode?: 'analysis', actor: Actor = operator) {
  const { service } = context.programming;
  const id = service.start(actor, { botId: 'alpha', projectId: 'shop', taskId: 'fix', text, ...(mode && { mode }) }).run.id;
  service.kick();
  await service.idle();
  return id;
}
const types = (context: ReturnType<typeof setup>, runId: string) => readJournal(context.programming.database, { runId }).map((event) => event.envelope);

describe('M05/M06 delivery tools in a real agent loop with a simulated runner', () => {
  it('fixes, validates the flow on the preview of the current revision and delivers a draft PR with CI', async () => {
    const context = setup({
      steps: [
        ...fix,
        ...validate,
        () => ({ tool: 'publication_review', args: {} }),
        () => ({ tool: 'publication_publish', args: { title: 'Valida CEP no checkout', body: 'Problema: CEP aceito sem validação.', commitMessage: 'fix: valida CEP no checkout' } }),
        () => ({ tool: 'publication_ci', args: { waitSeconds: 5 } }),
        () => ({ tool: 'programming_complete', args: { summary: 'CEP validado, fluxo verificado na prévia e draft PR #12 com CI aprovado.' } }),
        () => ({ text: 'Concluído.' }),
      ],
    });
    const id = await runOnce(context);
    const { store } = context.programming;
    const run = store.getRun(id)!;
    expect(run).toMatchObject({ state: 'completed', finalOutcome: { delivery: 'draft_pr' } });
    expect(Object.fromEntries(store.criteria(id).map((criterion) => [criterion.id, criterion.status]))).toEqual({
      changes: 'satisfied',
      checks: 'satisfied',
      draft_pr: 'satisfied',
      checkout_cep: 'satisfied',
    });
    // The functional evidence names the URL, revision, viewport, preconditions and steps.
    const functional = store.evidence<Evidence>(id).map((item) => item.value).find((item) => item.kind === 'functional') as Extract<Evidence, { kind: 'functional' }>;
    expect(functional).toMatchObject({ result: 'passed', previewId: 'fix', viewport: '1280x800', url: PREVIEW });
    expect(functional.revisions).toMatchObject({ app: expect.stringMatching(/^tree:/), 'env:web': expect.stringMatching(/^cfg:/) });
    const content = context.programming.artifacts.read(operator, functional.artifactId!);
    expect(JSON.parse(content.content.toString())).toMatchObject({
      preconditions: expect.arrayContaining(['prévia saudável da revisão atual']),
      steps: [`navegar ${PREVIEW}`, 'clicar e1'],
      network: [{ status: 422 }],
      screenshotArtifactId: expect.any(String),
    });
    // The published draft carries the local checks of exactly this revision.
    const published = context.runner.published[0];
    expect(published.checks).toEqual([{ kind: 'test', result: 'passed', revision: functional.revisions!.app }]);
    expect(published.expectedRevision).toBe(functional.revisions!.app);
    expect(published.body).toContain('aprovada: Checkout mostra erro de CEP inválido');
    expect(store.publicationsForRun(id)).toEqual([expect.objectContaining({ prNumber: 12, draft: true, branch: 'task/fix', checkRefs: ['a'.repeat(40) + ':passed'] })]);
    // The final message lists the real validations, the PR link and the authorized run page.
    const report = context.programming.service.report(id);
    expect(report).toContain('test aprovado');
    expect(report).toContain('Fluxo Checkout mostra erro de CEP inválido: aprovado (1280x800)');
    expect(report).toContain('https://github.com/acme/shop/pull/12 — CI aprovado (validado integralmente)');
    expect(report).toContain(`Detalhes: http://127.0.0.1:3000/bots/alpha/trabalhos/${id}`);
    const events = types(context, id);
    const names = events.map((event) => event.type);
    for (const type of ['preview_started', 'preview_ready', 'browser_session_created', 'browser_action_started', 'browser_action_finished', 'browser_navigation_allowed', 'browser_navigation_denied', 'browser_network_error', 'functional_check_finished', 'draft_pull_request_created', 'git_push_finished', 'ci_poll_finished'])
      expect(names, type).toContain(type);
    // Runner telemetry is ingested once, without its own copy of the operation receipts.
    expect(events.filter((event) => event.type === 'draft_pull_request_created')).toHaveLength(1);
    expect(events.filter((event) => event.producer === 'runner:publication').map((event) => event.type)).not.toContain('operation_intended');
    expect(events.find((event) => event.type === 'browser_navigation_denied')?.payload).toMatchObject({ origin: 'http://169.254.169.254', rule: 'default' });
    // The runner received the run correlation for every effect.
    expect(context.runner.calls.filter((call) => ['startPreview', 'browserSession', 'publish'].includes(call.action)).every((call: any) => call.correlation?.runId === id)).toBe(true);
  }, 60_000);

  it('does not let an old functional result approve a later revision', async () => {
    const context = setup({
      steps: [
        ...fix,
        ...validate,
        // Cycle 1 ends with the flow approved; cycle 2 changes the code again.
        () => ({ text: 'Fluxo validado; sigo refinando.' }),
        () => ({ tool: 'workspace_read_range', args: { path: 'page.txt' } }),
        (messages) => ({ tool: 'workspace_replace', args: { path: 'page.txt', expectedHash: lastResult(messages).hash, oldText: 'validate-cep', newText: 'validate-cep v2' } }),
        () => ({ tool: 'workspace_check', args: { kind: 'test', command: 'node check.cjs' } }),
        // Validating again without rebuilding is refused: the preview is of the old revision.
        () => ({ tool: 'functional_check', args: { criterionId: 'checkout_cep', description: 'Checkout mostra erro de CEP inválido', expect: { text: ['Erro: CEP inválido'] } } }),
        () => ({ tool: 'programming_complete', args: { summary: 'Pronto.' } }),
        () => ({ text: 'Tentei concluir.' }),
      ],
      publish: false,
    });
    const id = await runOnce(context);
    const { store } = context.programming;
    const refused = context.provider.requests.flatMap((request) => request.messages).filter((message) => message.role === 'tool' && String(message.content).includes('preview_outdated'));
    expect(refused.length).toBeGreaterThan(0);
    expect(store.criteria(id).find((criterion) => criterion.id === 'checkout_cep')?.status).toBe('invalidated');
    expect(store.getRun(id)?.state).not.toBe('completed');
    expect(types(context, id).filter((event) => event.type === 'evidence_invalidated').map((event) => event.payload?.criterionId)).toContain('checkout_cep');
  }, 60_000);

  it('offers no browser or publication tools to a bot without those capabilities', () => {
    const context = setup({ steps: [], browser: false, publish: false });
    const names = context.tools.map((tool) => tool.name);
    expect(names).toContain('workspace_preview');
    expect(names.filter((name) => name.startsWith('browser_') || name.startsWith('publication_') || name === 'functional_check')).toEqual([]);
    expect(DELIVERY_TOOL_NAMES.length).toBe(14);
  });

  it('denies the browser when the project disables it and persists the denial', async () => {
    const context = setup({
      steps: [() => ({ tool: 'browser_open', args: { kind: 'docs' } }), () => ({ tool: 'programming_complete', args: { summary: 'x', report: 'Sem navegador.' } }), () => ({ text: 'fim' })],
      projectBrowser: false,
    });
    const id = await runOnce(context, 'Pesquise a documentação.', 'analysis');
    const denied = types(context, id).find((event) => event.type === 'permission_denied');
    expect(denied?.payload).toMatchObject({ class: 'browser', operation: 'browser.session' });
    expect(context.runner.calls.some((call) => call.action === 'browserSession')).toBe(false);
  }, 60_000);

  it('browses docs in an analysis run but never publishes from it', async () => {
    const context = setup({
      steps: [
        () => ({ tool: 'browser_open', args: { kind: 'docs' } }),
        () => ({ tool: 'publication_publish', args: { title: 't', body: 'b', commitMessage: 'm' } }),
        () => ({ tool: 'programming_complete', args: { summary: 'Relatório entregue.', report: '# Análise\nNada publicado.' } }),
        () => ({ text: 'fim' }),
      ],
    });
    const id = await runOnce(context, 'Analise o checkout.', 'analysis');
    expect(context.programming.store.getRun(id)).toMatchObject({ state: 'completed', finalOutcome: { delivery: 'technical' } });
    expect(context.runner.calls.some((call) => call.action === 'browserSession')).toBe(true);
    expect(context.runner.published).toEqual([]);
    expect(types(context, id).find((event) => event.type === 'permission_denied')?.payload).toMatchObject({ code: 'analysis_only' });
  }, 60_000);
});

describe('RunnerReconciler for previews and publications', () => {
  const run = { id: 'run-1', botId: 'alpha', projectId: 'shop', taskId: 'fix', repositoryIds: ['app'] } as any;
  const receipt = (kind: string, extra: Record<string, unknown> = {}) => ({ operationId: 'op-1', kind, intent: { repositoryId: 'app', revision: 'tree:' + 'b'.repeat(40) }, ...extra }) as any;

  it('proves a lost publish from the runner receipt and remote branch, and never guesses', async () => {
    const repo = gitRepo(APP);
    cleanup.push(repo.cleanup);
    const runner = new DeliveryRunner(repo.worktree);
    const reconciler = new RunnerReconciler(runner, { waitMs: 50, pollMs: 5 });
    expect((await reconciler.reconcile(run, receipt('publication.publish'))).resolution).toBe('not_applied');
    runner.reconcile = { ok: true, state: 'synced', remote: { sha: 'c'.repeat(40) }, pullRequest: { number: 4, url: 'https://github.com/acme/shop/pull/4' }, receipts: [{ operationId: 'op-1', state: 'succeeded', phase: 'done' }] };
    const applied = await reconciler.reconcile(run, receipt('publication.publish'));
    expect(applied).toMatchObject({ resolution: 'applied', observed: [{ kind: 'publication', sha: 'c'.repeat(40), prNumber: 4, revision: 'tree:' + 'b'.repeat(40) }] });
    runner.reconcile = { ...runner.reconcile, receipts: [{ operationId: 'op-1', state: 'running', phase: 'pushed' }] };
    expect((await reconciler.reconcile(run, receipt('publication.publish'))).resolution).toBe('unknown');
    runner.reconcile = { ok: false, error: { code: 'rate_limited' } };
    expect(await reconciler.reconcile(run, receipt('publication.publish'))).toMatchObject({ resolution: 'unknown', evidence: { code: 'rate_limited' } });
  });

  it('resolves an interrupted preview from its job', async () => {
    const repo = gitRepo(APP);
    cleanup.push(repo.cleanup);
    const runner = new DeliveryRunner(repo.worktree);
    const reconciler = new RunnerReconciler(runner, { waitMs: 50, pollMs: 5 });
    expect((await reconciler.reconcile(run, receipt('workspace.startPreview'))).resolution).toBe('not_applied');
    const job = await runner.command<{ id: string }>({ action: 'startPreview', taskId: 'fix', environmentId: 'web' });
    expect((await reconciler.reconcile(run, receipt('workspace.startPreview', { jobId: job.id }))).resolution).toBe('applied');
    expect((await reconciler.reconcile(run, receipt('workspace.startPreview', { jobId: 'missing' }))).resolution).toBe('unknown');
  });
});

describe('M05/M02 delivery lifecycle', () => {
  const route = { channel: 'telegram', connectionId: '123', conversationId: '42' };

  it('invalidates the functional check when the environment changes, then revalidates on a new preview', async () => {
    const holder: { runner?: ReturnType<typeof setup>['runner'] } = {};
    const change: Step = () => {
      // Someone edits the environment between the check and the completion.
      holder.runner!.environment = { id: 'web', name: 'Web', cpus: 4 };
      return { tool: 'programming_complete', args: { summary: 'Pronto.' } };
    };
    const context = setup({
      steps: [
        ...fix,
        ...validate,
        () => ({ text: 'Fluxo validado.' }),
        change,
        () => ({ text: 'Tentei concluir.' }),
        ...validate.filter((_, index) => index !== 1 && index !== 3),
        () => ({ tool: 'programming_complete', args: { summary: 'Revalidado na configuração nova.' } }),
        () => ({ text: 'Concluído.' }),
      ],
      publish: false,
    });
    holder.runner = context.runner;
    const id = await runOnce(context);
    const { store, database } = context.programming;
    expect(store.getRun(id)?.state).toBe('completed');
    const observed = readJournal(database, { runId: id, type: 'revision_observed' }).map((event) => event.envelope.payload?.key);
    expect(observed).toContain('env:web');
    expect(readJournal(database, { runId: id, type: 'evidence_invalidated' }).map((event) => event.envelope.payload?.criterionId)).toContain('checkout_cep');
    const verdicts = readJournal(database, { runId: id, type: 'acceptance_evaluated' }).map((event) => event.envelope.payload?.verdict);
    expect(verdicts).toEqual(['rejected', 'accepted']);
    // The finished run leaves no browser session open.
    expect(context.runner.calls.filter((call) => call.action === 'browserClose').length).toBeGreaterThan(0);
    expect(readJournal(database, { runId: id, type: 'browser_session_closed' }).map((event) => event.envelope.payload?.reason)).toContain('run_completed');
  }, 60_000);

  it('binds a failed preview to the step that ran it, with its log', async () => {
    const context = setup({
      steps: [...fix, () => ({ tool: 'workspace_preview', args: {} }), () => ({ text: 'A prévia falhou; vou investigar.' })],
      publish: false,
    });
    context.runner.failPreview = true;
    const id = await runOnce(context);
    const { database, store } = context.programming;
    const failed = readJournal(database, { runId: id, type: 'preview_failed' })[0]?.envelope;
    const cycle = store.listSteps(id).filter((step) => step.kind === 'cycle')[0];
    expect(failed).toMatchObject({ stepId: cycle!.id, status: 'failed', payload: { code: 'build_or_health_failed', artifactId: expect.any(String) } });
    expect(store.listReceipts(id).find((receipt) => receipt.kind === 'workspace.startPreview')?.state).toBe('failed');
    const reply = context.provider.requests.flatMap((request) => request.messages).find((message) => message.role === 'tool' && String(message.content).includes('preview_failed'));
    expect(String(reply?.content)).toContain('healthcheck falhou');
  }, 60_000);

  it('delivers the final summary with the draft link and the authorized run page to the Telegram conversation', async () => {
    const context = setup({
      steps: [
        ...fix,
        () => ({ tool: 'publication_publish', args: { title: 'Valida CEP', body: 'Mudança.', commitMessage: 'fix: CEP' } }),
        () => ({ tool: 'programming_complete', args: { summary: 'CEP validado; draft aberto.' } }),
        () => ({ text: 'Concluído.' }),
      ],
    });
    const sent: { key: string; text: string }[] = [];
    context.programming.notifier.register('telegram', async (key, text) => {
      sent.push({ key, text });
    });
    const id = await runOnce(context, 'Valide o CEP.', undefined, channelActor('alpha', route, '42'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const final = sent.find((item) => item.text.includes('CEP validado; draft aberto.'));
    expect(final?.key).toBe('123:42');
    expect(final?.text).toContain('https://github.com/acme/shop/pull/12 — sem resultado de CI — draft não validado integralmente');
    expect(final?.text).toContain(`Detalhes: http://127.0.0.1:3000/bots/alpha/trabalhos/${id}`);
    expect(final?.text).toContain('test aprovado');
  }, 60_000);

  it('widens a check beyond the affected package only with a justification and estimates read tokens', async () => {
    const context = setup({
      steps: [
        () => ({ tool: 'workspace_read_range', args: { path: 'page.txt' } }),
        () => ({ tool: 'workspace_check', args: { kind: 'test', command: 'node check.cjs', scope: 'repository' } }),
        () => ({ tool: 'workspace_check', args: { kind: 'test', command: 'node check.cjs', scope: 'repository', justification: 'A mudança afeta o script de teste compartilhado na raiz.' } }),
        () => ({ text: 'Verificado.' }),
      ],
      publish: false,
    });
    const id = await runOnce(context, 'Analise o teste.', 'analysis');
    const { database } = context.programming;
    const refused = context.provider.requests.flatMap((request) => request.messages).find((message) => message.role === 'tool' && String(message.content).includes('justification_required'));
    expect(refused).toBeDefined();
    const started = readJournal(database, { runId: id, type: 'check_started' }).map((event) => event.envelope.payload);
    expect(started).toEqual([expect.objectContaining({ scope: 'repository', justification: expect.stringContaining('compartilhado') })]);
    const read = readJournal(database, { runId: id, type: 'workspace_read' })[0]?.envelope.payload as any;
    expect(read.estimatedTokens).toBe(Math.ceil(read.bytes / 4));
  }, 60_000);
});

describe('M09-S01 audit of a complete delivery', () => {
  it('journals only catalogued events with full correlation and keeps planted secrets out of every store', async () => {
    const context = setup({
      steps: [
        ...fix,
        ...validate,
        () => ({ tool: 'publication_publish', args: { title: 'Valida CEP', body: 'token sk-test-key-0123456789abcdef não deve vazar', commitMessage: 'fix: CEP' } }),
        () => ({ tool: 'publication_ci', args: { waitSeconds: 1 } }),
        () => ({ tool: 'programming_complete', args: { summary: 'Pronto.' } }),
        () => ({ text: 'Concluído.' }),
      ],
    });
    const id = await runOnce(context);
    await context.programming.deliverer.flush();
    const events = readJournal(context.programming.database, { runId: id }).map((event) => event.envelope);
    const unknown = events.filter((event) => !(event.type in TELEMETRY_CATALOG)).map((event) => event.type);
    expect(unknown).toEqual([]);
    for (const event of events) expect(event, event.type).toMatchObject({ botId: 'alpha', runId: id, schemaVersion: expect.any(Number), eventId: expect.any(String) });
    expect(events.filter((event) => event.stepId).length).toBeGreaterThan(events.length / 2);
    // Planted key: never in the run database, the bot telemetry or any artifact.
    const secret = 'sk-test-key-0123456789abcdef';
    const files = [join(context.root, '.harness/programming.db'), join(context.root, '.harness/programming.db-wal')].filter((path) => existsSync(path));
    const walk = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])) : []);
    for (const path of [...files, ...walk(join(context.root, '.harness/programming-artifacts')), ...walk(join(context.root, '.harness/bots'))])
      expect(readFileSync(path).toString('latin1').includes(secret), path).toBe(false);
  }, 60_000);
});

describe('M02-S01 the run tools only act on the run worktree', () => {
  it('refuses a repository outside the run and works only after the task exists', async () => {
    const context = setup({
      steps: [
        () => ({ tool: 'workspace_search', args: { query: 'entrega', repositoryId: 'outro-repo' } }),
        () => ({ tool: 'workspace_read_range', args: { path: '../../etc/passwd' } }),
        () => ({ tool: 'programming_complete', args: { summary: 'Análise.', report: 'Nada alterado.' } }),
        () => ({ text: 'fim' }),
      ],
      publish: false,
    });
    const id = await runOnce(context, 'Analise o projeto.', 'analysis');
    const results = context.provider.requests.flatMap((request) => request.messages).filter((message) => message.role === 'tool').map((message) => String(message.content));
    expect(results.some((text) => text.includes('invalid_repository'))).toBe(true);
    expect(results.some((text) => /invalid_path|symlink_escape|fora da worktree/.test(text))).toBe(true);
    expect(context.runner.calls.some((call) => call.action === 'searchContent')).toBe(false);
    // Without a prepared task the tools refuse instead of guessing one.
    const noTask = setup({ steps: [() => ({ tool: 'workspace_read_range', args: { path: 'page.txt' } }), () => ({ text: 'fim' })], publish: false });
    const { service } = noTask.programming;
    const run = service.start(operator, { botId: 'alpha', projectId: 'shop', text: 'x', mode: 'analysis' }).run.id;
    service.kick();
    await service.idle();
    const replies = noTask.provider.requests.flatMap((request) => request.messages).filter((message) => message.role === 'tool').map((message) => String(message.content));
    expect(replies[0]).toContain('no_task');
    expect(noTask.programming.store.getRun(run)).toBeDefined();
    expect(context.programming.store.getRun(id)?.state).toBe('completed');
  }, 60_000);
});

describe('M05 browser failures and cancellation', () => {
  it('binds a browser failure to the step that tried it', async () => {
    const context = setup({ steps: [() => ({ tool: 'browser_open', args: { kind: 'test' } }), () => ({ text: 'Sem navegador.' })], publish: false });
    context.runner.failBrowser = true;
    const id = await runOnce(context, 'Analise a prévia.', 'analysis');
    const failed = readJournal(context.programming.database, { runId: id, type: 'browser_session_failed' })[0]?.envelope;
    const cycle = context.programming.store.listSteps(id).find((step) => step.kind === 'cycle');
    expect(failed).toMatchObject({ stepId: cycle!.id, status: 'failed', payload: { code: 'browser_unavailable' } });
  }, 60_000);

  it('closes the run browser sessions when the run is cancelled', async () => {
    const context = setup({
      steps: [() => ({ tool: 'browser_open', args: { kind: 'test' } }), () => ({ tool: 'workspace_check', args: { kind: 'test', command: 'sleep 5' } }), () => ({ text: 'fim' })],
      publish: false,
    });
    const { service, store, database } = context.programming;
    const id = service.start(operator, { botId: 'alpha', projectId: 'shop', taskId: 'fix', text: 'x' }).run.id;
    service.kick();
    const deadline = Date.now() + 10_000;
    while (!store.listReceipts(id, ['running']).some((receipt) => receipt.kind === 'workspace.check') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    service.control(operator, id, 'cancel');
    await service.idle();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.getRun(id)?.state).toBe('cancelled');
    expect(context.runner.calls.some((call) => call.action === 'browserClose')).toBe(true);
    expect(readJournal(database, { runId: id, type: 'browser_session_closed' }).map((event) => event.envelope.payload?.reason)).toContain('run_cancelled');
  }, 60_000);
});
