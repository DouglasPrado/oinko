import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent } from '@oinko/core';
import {
  AgentCycleExecutor,
  EMPTY_METRICS,
  PROGRAMMING_RUN_INSTRUCTIONS,
  ProgrammingError,
  classifyRun,
  readJournal,
  type Actor,
  type Aggregate,
  type AttemptResult,
  type EvaluationBatch,
  type EvaluationCase,
  type EvaluationEnvironment,
  type EvaluationService,
  type Evidence,
  type ProgrammingPolicy,
  type RunExecutor,
} from '@oinko/agent-runtime/programming';
import { EnvironmentClient, environmentRequest } from '@oinko/environments/client';
import { runCommand } from '@oinko/environments/command';
import { WorkspaceStore } from '@oinko/workspaces';
import type { BotDefinition } from '../../schema.js';
import { BotStore } from '../../store.js';
import { deliveryTools } from '../delivery-tools.js';
import { programmingRunTools } from '../run-tools.js';
import { openProgramming, type ProgrammingRuntime } from '../runtime.js';
import type { RunnerPort } from '../tool-kit.js';
import { LocalRunner } from './local-runner.js';
import { simulatedProvider } from './simulated-provider.js';

/** Marker of a root created by the harness: nothing else is ever evaluated into. */
const MARKER = '.harness/evaluation-root';
const PROJECT = 'eval';
const SIMULATED_KEY = 'sk-evaluation-simulated-000000';
const FIXED_GIT_ENV = {
  GIT_AUTHOR_NAME: 'oinko-evaluation',
  GIT_AUTHOR_EMAIL: 'evaluation@oinko.invalid',
  GIT_COMMITTER_NAME: 'oinko-evaluation',
  GIT_COMMITTER_EMAIL: 'evaluation@oinko.invalid',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
};

export interface EvaluationRunOptions {
  /** Records batches and results (normally the installation's programming.db). */
  evaluation: EvaluationService;
  actor: Actor;
  datasetVersion: string;
  /** The bot as configured; `change` (a candidate) applies only inside the isolated roots. */
  bot: BotDefinition;
  subject: 'baseline' | (string & {});
  change?: { programmingPolicy: ProgrammingPolicy; systemPrompt: string };
  environment: EvaluationEnvironment;
  repetitions?: number;
  split?: 'tuning' | 'validation';
  /** Parent of the isolated attempt roots; must be outside the installation root. */
  workRoot: string;
  /** The installation root, to refuse evaluating into production. */
  productionRoot?: string;
  /** Real provider only. */
  apiKey?: string;
  /** Environment runner entry point, for docker and real environments. */
  runnerPath?: string;
  attemptTimeoutMs?: number;
  /** Keep attempt roots (worktrees, artifacts) for inspection. */
  keep?: boolean;
  /** Extra manifest fields, e.g. the platform commit. */
  manifest?: Record<string, unknown>;
}

/** Refuses any root that is, or lives inside, the installation being served. */
export function assertIsolatedRoot(workRoot: string, productionRoot?: string): void {
  if (!productionRoot) return;
  const work = resolve(workRoot);
  const production = resolve(productionRoot);
  if (work === production || work.startsWith(production + sep))
    throw new ProgrammingError('permission_denied', 'A avaliação só roda em uma raiz isolada, fora da instalação em produção.');
}

/** Commits fixture files with a fixed author and date: same files, same commit. */
export function materializeFixture(testCase: EvaluationCase, dir: string): { dir: string; commit: string } {
  mkdirSync(dir, { recursive: true });
  const env = { ...process.env, ...FIXED_GIT_ENV };
  if ('files' in testCase.fixture) {
    for (const [path, content] of Object.entries(testCase.fixture.files)) {
      const target = join(dir, path);
      if (relative(dir, target).startsWith('..')) throw new ProgrammingError('invalid_request', `Caminho de fixture inválido: ${path}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env });
    execFileSync('git', ['add', '-A'], { cwd: dir, env });
    execFileSync('git', ['commit', '-q', '-m', `fixture ${testCase.id}`], { cwd: dir, env });
  } else {
    execFileSync('git', ['clone', '-q', testCase.fixture.repository.url, dir], { env });
    execFileSync('git', ['checkout', '-q', testCase.fixture.repository.commit], { cwd: dir, env });
  }
  return { dir, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim() };
}

function skipReason(testCase: EvaluationCase, options: EvaluationRunOptions): string | undefined {
  if (options.environment !== 'real') {
    if (testCase.requires.includes('real_provider')) return 'real_provider_required';
    if (!testCase.simulation) return 'no_simulation';
  }
  if (options.environment === 'simulated' && testCase.requires.includes('docker')) return 'docker_required';
  if (options.environment === 'real' && !options.apiKey) return 'real_provider_unavailable';
  if (options.environment !== 'simulated' && !options.runnerPath) return 'docker_unavailable';
  // A real preview needs an environment with services; the harness only provides the simulated one.
  if (options.environment !== 'simulated' && testCase.requires.includes('preview')) return 'preview_environment_unavailable';
  return undefined;
}

function policyVersionOf(definition: BotDefinition): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ model: definition.model, systemPrompt: definition.systemPrompt, programmingPolicy: definition.programmingPolicy }))
    .digest('hex');
  return `cfg:${digest.slice(0, 16)}`;
}

/**
 * Runs a dataset against one configuration of a bot, each attempt in its own
 * isolated root: fresh fixture at a pinned commit, no GitHub App, no
 * publisher, the same run tools and instructions as production. Results
 * (including skipped attempts, never counted as passed) go to `evaluation`.
 */
export async function runEvaluation(options: EvaluationRunOptions): Promise<{ batch: EvaluationBatch; aggregate: Aggregate; results: AttemptResult[] }> {
  assertIsolatedRoot(options.workRoot, options.productionRoot);
  const dataset = options.evaluation.store.dataset(options.datasetVersion);
  if (!dataset) throw new ProgrammingError('not_found', 'Dataset inexistente.');
  const definition: BotDefinition = {
    ...options.bot,
    ...(options.change && { systemPrompt: options.change.systemPrompt, programmingPolicy: options.change.programmingPolicy }),
  };
  const policy = definition.programmingPolicy;
  if (!policy?.enabled) throw new ProgrammingError('capability_disabled', 'Avalie um bot com trabalhos de programação habilitados.');
  const cases = options.split ? dataset.cases.filter((item) => item.split === options.split) : dataset.cases;
  const repetitions = options.repetitions ?? (options.environment === 'real' ? 3 : 1);
  const batch = options.evaluation.startBatch(options.actor, {
    datasetVersion: options.datasetVersion,
    botId: definition.id,
    subject: options.subject,
    policyVersion: policyVersionOf(definition),
    environment: options.environment,
    repetitions,
    manifest: {
      ...options.manifest,
      date: new Date().toISOString(),
      environment: options.environment,
      provider: options.environment === 'real' ? 'real' : 'simulated',
      workspace: options.environment === 'simulated' ? 'local-simulated' : 'docker',
      models: { main: policy.models.main ?? definition.model, ...(policy.models.fast && { fast: policy.models.fast }) },
      node: process.version,
      cases: cases.map((item) => item.id),
    },
  });
  mkdirSync(options.workRoot, { recursive: true });
  const results: AttemptResult[] = [];
  for (const testCase of cases)
    for (let repetition = 1; repetition <= repetitions; repetition++) {
      const result = await attempt(testCase, repetition, definition, batch, options);
      options.evaluation.caseFinished(batch.id, result);
      results.push(result);
    }
  return { batch, aggregate: options.evaluation.finishBatch(batch.id), results };
}

async function attempt(testCase: EvaluationCase, repetition: number, definition: BotDefinition, batch: EvaluationBatch, options: EvaluationRunOptions): Promise<AttemptResult> {
  const skipped = skipReason(testCase, options);
  if (skipped) {
    options.evaluation.caseStarted(batch.id, testCase.id, repetition);
    return { caseId: testCase.id, repetition, verdict: 'skipped', failure: { category: 'environment', code: skipped }, criteria: [], metrics: EMPTY_METRICS, evidenceRefs: [], traceIds: [] };
  }
  const root = mkdtempSync(join(options.workRoot, `${testCase.id}-${repetition}-`));
  mkdirSync(join(root, '.harness'), { recursive: true });
  writeFileSync(join(root, MARKER), `${batch.id}\n`);
  const fixture = materializeFixture(testCase, join(root, 'fixture'));
  const botId = definition.id;
  const bots = new BotStore(root);
  bots.save(
    { ...definition, telemetry: { enabled: true, capture: 'full', retentionDays: 7 }, telegram: { ...definition.telegram, enabled: false }, intelligence: undefined, mcps: [] },
    { apiKey: options.environment === 'real' ? options.apiKey! : SIMULATED_KEY },
    0,
  );
  const runner = await prepareRunner(root, botId, fixture.dir, options);
  const provider = options.environment === 'real' ? undefined : simulatedProvider(testCase.simulation!.steps);
  const pending = [...testCase.interruptions].sort((a, b) => a.afterCycle - b.afterCycle);
  // A restart happens at a cycle boundary: the next cycle waits here until the process goes away.
  let atBoundary: (() => void) | undefined;
  const cycles: { current?: RunExecutor } = {};
  const aborted = (signal: AbortSignal) =>
    new Promise<never>((_, reject) => {
      if (signal.aborted) reject(signal.reason as Error);
      else signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
    });
  let limit: string | undefined;
  const executor: RunExecutor = {
    runCycle: async (input) => {
      // The cycle limit is the case's, enforced before an extra cycle can run.
      if (input.cycle > testCase.limits.maxCycles) {
        limit = 'max_cycles';
        programming.service.control({ kind: 'operator', id: 'evaluation' }, input.run.id, 'cancel', { reason: limit }, `evaluation:${limit}`);
        return aborted(input.context.signal);
      }
      if (pending[0] && input.cycle === pending[0].afterCycle + 1) {
        atBoundary?.();
        return aborted(input.context.signal);
      }
      return cycles.current!.runCycle(input);
    },
  };
  const open = () =>
    openProgramming({
      root,
      producer: `evaluation:${botId}`,
      executeFor: botId,
      bots,
      runner,
      leaseTtlMs: 300,
      executor,
      secrets: () => [options.apiKey, SIMULATED_KEY].filter((value): value is string => !!value),
    });
  let programming: ProgrammingRuntime = open();
  const policy = definition.programmingPolicy!;
  // A new process has a new agent: nothing but persisted state crosses a restart.
  const makeAgent = (runtime: ProgrammingRuntime) => {
    const created = Agent.create({
      apiKey: options.environment === 'real' ? options.apiKey! : SIMULATED_KEY,
      model: policy.models.main ?? definition.model,
      ...(definition.baseUrl && { baseUrl: definition.baseUrl }),
      systemPrompt: `${definition.systemPrompt}\n${PROGRAMMING_RUN_INSTRUCTIONS}`,
      ...(provider && { fetch: provider.fetch }),
      memory: { enabled: false },
      knowledge: { enabled: false },
      telemetry: { enabled: true, dbPath: bots.runtime(botId).paths.telemetryDbPath, app: botId, capturePayloads: 'full' },
      logLevel: 'silent',
    });
    const tools = [
      ...programmingRunTools({ runner, service: runtime.service, pollMs: 20 }),
      ...deliveryTools({
        runner,
        access: runtime.access,
        service: runtime.service,
        evidence: (runId) => runtime.store.evidence<Evidence>(runId).map((item) => item.value),
        journal: runtime.journal,
        capabilities: policy.capabilities,
        pollMs: 20,
        ciPollMs: 1000,
      }),
    ];
    for (const tool of tools) created.addTool(tool);
    cycles.current = new AgentCycleExecutor(created);
    return created;
  };
  let agent = makeAgent(programming);
  const operator: Actor = { kind: 'operator', id: 'evaluation' };
  const started = Date.now();
  let restarts = 0;
  let runId: string | undefined;
  try {
    const { run } = programming.service.start(operator, {
      botId,
      projectId: PROJECT,
      text: testCase.request.text,
      mode: testCase.request.mode,
      criteria: testCase.criteria,
    });
    runId = run.id;
    options.evaluation.caseStarted(batch.id, testCase.id, repetition, run.id);
    let boundary = false;
    atBoundary = () => {
      boundary = true;
    };
    programming.startWorker();
    const deadline = started + (options.attemptTimeoutMs ?? 600_000);
    let cancelled: string | undefined;
    for (;;) {
      const current = programming.store.requireRun(run.id);
      if (['completed', 'failed', 'cancelled', 'blocked'].includes(current.state)) break;
      if (boundary) {
        // Process restart: the run stays durable and a new process recovers it.
        boundary = false;
        pending.shift();
        await programming.close();
        await agent.destroy();
        restarts++;
        programming = open();
        agent = makeAgent(programming);
        programming.startWorker();
      } else if (!cancelled && Date.now() > deadline) {
        cancelled = 'timeout';
        programming.service.control(operator, run.id, 'cancel', { reason: cancelled }, `evaluation:${cancelled}`);
      }
      await delay(20);
    }
    await programming.service.idle();
    const stopped = limit ?? cancelled;
    return { ...collect(programming, testCase, repetition, run.id, { started, restarts, ...(stopped && { cancelled: stopped }) }), fixtureCommit: fixture.commit };
  } catch (error) {
    return {
      caseId: testCase.id,
      repetition,
      verdict: 'infra_failure',
      ...(runId && { runId }),
      failure: { category: 'environment', code: error instanceof ProgrammingError ? error.code : 'harness_error' },
      criteria: [],
      metrics: { ...EMPTY_METRICS, durationMs: Date.now() - started, restarts },
      evidenceRefs: [],
      traceIds: [],
    };
  } finally {
    await programming.close().catch(() => undefined);
    await agent.destroy().catch(() => undefined);
    bots.close();
    if (options.environment !== 'simulated') await stopSandbox(root);
    if (!options.keep) rmSync(root, { recursive: true, force: true });
  }
}

/** Stops the attempt root's runner and removes only that root's containers. */
async function stopSandbox(root: string): Promise<void> {
  const health = await environmentRequest<{ pid: number }>(root, '/health', undefined, 1000).catch(() => undefined);
  if (health?.pid) {
    try {
      process.kill(health.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    await delay(500);
  }
  const namespace = `oinko-${createHash('sha256').update(root).digest('hex').slice(0, 10)}`;
  const ids = (await runCommand('docker', ['ps', '-aq', '--filter', `name=^${namespace}-`]).catch(() => ({ stdout: '' }))).stdout.trim().split(/\s+/).filter(Boolean);
  if (ids.length) await runCommand('docker', ['rm', '-f', ...ids]).catch(() => undefined);
}

async function prepareRunner(root: string, botId: string, source: string, options: EvaluationRunOptions): Promise<RunnerPort> {
  if (options.environment === 'simulated') {
    const workspaces = new WorkspaceStore(root);
    workspaces.saveProject(
      { id: PROJECT, name: 'Avaliação', repositories: [{ id: 'app', source }], allowedBotIds: [botId], programming: { browser: { enabled: true } } },
      0,
    );
    workspaces.close();
    return new LocalRunner(source, 'fix', { projectId: PROJECT });
  }
  // Docker sandbox: the shipped runner imports the fixture and isolates every command.
  const admin = new EnvironmentClient(root, undefined, { runnerPath: options.runnerPath! });
  await admin.command({ action: 'saveEnvironment', definition: { id: 'node', name: 'Node' }, revision: 0 });
  await admin.command({
    action: 'saveProject',
    definition: { id: PROJECT, name: 'Avaliação', environmentId: 'node', repositories: [{ id: 'app', source }], allowedBotIds: [botId], programming: { browser: { enabled: true } } },
    revision: 0,
  });
  return new EnvironmentClient(root, botId, { runnerPath: options.runnerPath! });
}

function collect(
  programming: ProgrammingRuntime,
  testCase: EvaluationCase,
  repetition: number,
  runId: string,
  context: { started: number; restarts: number; cancelled?: string },
): AttemptResult {
  const run = programming.store.requireRun(runId);
  const criteria = programming.store.criteria(runId).map((criterion) => ({ id: criterion.id, status: criterion.status }));
  const evidence = programming.store.evidence<Evidence>(runId).map((item) => item.value);
  const events = readJournal(programming.database, { runId }).map((event) => event.envelope);
  const usage = programming.usage.metrics(runId);
  const artifacts = programming.artifacts.listForRun(runId);
  const missing = testCase.expectedArtifacts.filter((type) => !artifacts.some((artifact) => artifact.type === type));
  const interventions = programming.store.controls(runId).filter((control) => control.actor.kind !== 'system' && !(control.actor.kind === 'operator' && control.actor.id === 'evaluation')).length;
  const allSatisfied = criteria.length > 0 && criteria.every((criterion) => criterion.status === 'satisfied');
  const failure = context.cancelled
    ? { category: 'criteria' as const, code: context.cancelled }
    : run.state === 'completed' && missing.length
      ? { category: 'criteria' as const, code: `missing_artifact:${missing.join(',')}` }
      : classifyRun(run, evidence, events);
  const verdict: AttemptResult['verdict'] = run.state === 'completed' && allSatisfied && !missing.length && !context.cancelled ? 'passed' : failure?.category === 'environment' ? 'infra_failure' : 'failed';
  return {
    caseId: testCase.id,
    repetition,
    verdict,
    runId,
    ...(verdict !== 'passed' && failure && { failure }),
    criteria,
    metrics: {
      durationMs: (run.finishedAt ?? Date.now()) - context.started,
      calls: usage.calls,
      cycles: run.cycleCount,
      tokens: { total: usage.tokens.total, byRole: usage.tokens.byRole },
      cost: { confirmedUsd: usage.cost.confirmedUsd, pendingCalls: usage.cost.pendingCalls, unavailableCalls: usage.cost.unavailableCalls, confirmedCalls: usage.cost.confirmedCalls },
      interventions,
      restarts: context.restarts,
      fallbacks: events.filter((event) => event.type === 'model_fallback_triggered').length,
    },
    evidenceRefs: artifacts.map((artifact) => artifact.id),
    traceIds: programming.store.listSteps(runId).flatMap((step) => step.traceIds),
  };
}
