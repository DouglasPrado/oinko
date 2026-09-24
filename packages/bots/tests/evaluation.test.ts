/* eslint-disable @typescript-eslint/no-explicit-any -- journal payloads are untyped JSON */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProgrammingPolicySchema, readJournal, type EvaluationDataset } from '@oinko/agent-runtime/programming';
import { BotStore } from '../src/store.js';
import { openProgramming } from '../src/programming/runtime.js';
import { assertIsolatedRoot, materializeFixture, runEvaluation } from '../src/programming/evaluation/harness.js';

const DATASET = JSON.parse(readFileSync(new URL('../evaluation/programming-baseline.v1.json', import.meta.url), 'utf8')) as EvaluationDataset;
const operator = { kind: 'operator' as const, id: 'ops' };
const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

function installation(policy: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oinko-eval-prod-'));
  const work = mkdtempSync(join(tmpdir(), 'oinko-eval-work-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }), () => rmSync(work, { recursive: true, force: true }));
  const bots = new BotStore(root);
  bots.save({ id: 'alpha', name: 'Alpha', model: 'main-model', systemPrompt: 'Você programa com cuidado.', programmingPolicy: { enabled: true, ...policy } }, { apiKey: 'sk-prod-0123456789abcdef' }, 0);
  const runtime = openProgramming({ root, producer: 'dashboard', bots });
  cleanup.push(async () => {
    await runtime.close();
    bots.close();
  });
  return { root, work, bots, runtime };
}
const definition = (bots: BotStore) => bots.runtime('alpha').definition;
const events = (runtime: ReturnType<typeof installation>['runtime'], type: string) => readJournal(runtime.database, { type }).map((event) => event.envelope.payload as any);

describe('M00-S03 frozen scenarios and simulated baseline', () => {
  it('runs the four frozen cases in isolated roots and records every case', async () => {
    const { work, bots, runtime } = installation();
    const { version } = runtime.evaluation.createDataset(operator, DATASET);
    const { batch, aggregate, results } = await runEvaluation({
      evaluation: runtime.evaluation,
      actor: operator,
      datasetVersion: version,
      bot: definition(bots),
      subject: 'baseline',
      environment: 'simulated',
      workRoot: work,
      manifest: { platformCommit: 'test' },
    });
    expect(results.map((result) => [result.caseId, result.verdict, result.failure?.code])).toEqual([
      ['bug-sum', 'passed', undefined],
      ['monorepo-slugify', 'passed', undefined],
      ['visual-selo', 'passed', undefined],
      ['long-interrupted', 'passed', undefined],
    ]);
    // The long case survived a process restart through persisted state only.
    expect(results.find((result) => result.caseId === 'long-interrupted')!.metrics).toMatchObject({ restarts: 1 });
    expect(results.find((result) => result.caseId === 'long-interrupted')!.metrics.cycles).toBeGreaterThan(1);
    expect(aggregate).toMatchObject({ completionRate: 1, verdicts: { passed: 4, failed: 0, infra_failure: 0, skipped: 0 } });
    // Simulated usage has no reported cost: it is unknown, not zero.
    expect(aggregate.cost).toMatchObject({ coverage: 'none', perCompletedUsd: null, lowerBound: true });
    expect(aggregate.tokens.total).toBeGreaterThan(0);
    expect(runtime.evaluation.store.batch(batch.id)).toMatchObject({ status: 'finished', manifest: { provider: 'simulated', workspace: 'local-simulated', models: { main: 'main-model' }, platformCommit: 'test' } });
    expect(events(runtime, 'evaluation_case_finished').map((payload) => payload.caseId)).toEqual(['bug-sum', 'monorepo-slugify', 'visual-selo', 'long-interrupted']);
    expect(events(runtime, 'evaluation_started')[0]).toMatchObject({ datasetVersion: version, environment: 'simulated' });
    // No attempt left anything in the installation root.
    expect(runtime.store.listRuns({}).items).toEqual([]);
  }, 120_000);

  it('reproduces inputs exactly and never counts a skipped case as passed', async () => {
    const a = mkdtempSync(join(tmpdir(), 'oinko-fixture-'));
    const b = mkdtempSync(join(tmpdir(), 'oinko-fixture-'));
    cleanup.push(() => rmSync(a, { recursive: true, force: true }), () => rmSync(b, { recursive: true, force: true }));
    expect(materializeFixture(DATASET.cases[0]!, join(a, 'repo')).commit).toBe(materializeFixture(DATASET.cases[0]!, join(b, 'repo')).commit);
    const { work, bots, runtime } = installation();
    const { version } = runtime.evaluation.createDataset(operator, DATASET);
    // Real provider without credentials: every attempt is skipped, none passes, cost stays unknown.
    const { aggregate, results } = await runEvaluation({ evaluation: runtime.evaluation, actor: operator, datasetVersion: version, bot: definition(bots), subject: 'baseline', environment: 'real', workRoot: work, repetitions: 3 });
    expect(results).toHaveLength(12);
    expect(new Set(results.map((result) => result.failure?.code))).toEqual(new Set(['real_provider_unavailable']));
    expect(aggregate).toMatchObject({ completionRate: null, verdicts: { passed: 0, skipped: 12 }, sample: { insufficient: true } });
  });

  it('refuses to evaluate into the installation root and never publishes from an attempt', async () => {
    const { root, work, bots, runtime } = installation();
    expect(() => assertIsolatedRoot(join(root, 'avaliacao'), root)).toThrow(/raiz isolada/);
    const publishing: EvaluationDataset = {
      name: 'replay-guard',
      description: '',
      cases: [
        {
          ...DATASET.cases[0]!,
          id: 'replay',
          simulation: {
            steps: [
              { tool: 'workspace_prepare_task', args: {} },
              { tool: 'publication_publish', args: { title: 'x', body: 'y', commitMessage: 'z' } },
              { tool: 'programming_complete', args: { summary: 'x' } },
              { text: 'fim' },
            ],
          },
          limits: { maxCycles: 2 },
        },
      ],
    };
    const { version } = runtime.evaluation.createDataset(operator, publishing);
    await expect(runEvaluation({ evaluation: runtime.evaluation, actor: operator, datasetVersion: version, bot: definition(bots), subject: 'baseline', environment: 'simulated', workRoot: join(root, 'x'), productionRoot: root })).rejects.toThrow(/raiz isolada/);
    const { results } = await runEvaluation({ evaluation: runtime.evaluation, actor: operator, datasetVersion: version, bot: definition(bots), subject: 'baseline', environment: 'simulated', workRoot: work, productionRoot: root, keep: true });
    expect(results[0]!.verdict).toBe('failed');
    const attemptRoot = readFileSync(join(work, readdirSync(work)[0]!, '.harness/evaluation-root'), 'utf8');
    expect(attemptRoot).toContain('evb-');
    const attempt = openProgramming({ root: join(work, readdirSync(work)[0]!), producer: 'inspect' });
    try {
      const denied = readJournal(attempt.database, { type: 'permission_denied' }).map((event) => event.envelope.payload as any);
      expect(denied[0]).toMatchObject({ class: 'publish' });
      expect(attempt.store.listReceipts(results[0]!.runId!).filter((receipt) => receipt.kind === 'publication.publish')).toEqual([]);
    } finally {
      await attempt.close();
    }
  }, 60_000);
});

describe('M08-S04 from opportunity to rollback in an evaluation environment', () => {
  it('evaluates a candidate against the baseline, promotes it after approval and rolls it back', async () => {
    // Baseline: two iterations per cycle make the bug case run out of cycles.
    const tight = { cycle: { maxIterations: 2, noProgressLimit: 3, commandTimeoutSeconds: 600 } };
    const { work, bots, runtime } = installation(tight);
    const dataset: EvaluationDataset = { name: 'bug-only', description: '', cases: [{ ...DATASET.cases[0]!, limits: { maxCycles: 3 } }] };
    const { version } = runtime.evaluation.createDataset(operator, dataset);
    const baseline = await runEvaluation({ evaluation: runtime.evaluation, actor: operator, datasetVersion: version, bot: definition(bots), subject: 'baseline', environment: 'simulated', workRoot: work });
    expect(baseline.results[0]).toMatchObject({ verdict: 'failed', failure: { code: 'max_cycles' } });
    expect(events(runtime, 'improvement_opportunity_detected')[0]).toMatchObject({ category: 'criteria' });

    const current = definition(bots);
    const candidate = runtime.evaluation.createCandidate(operator, {
      botId: 'alpha',
      kind: 'policy',
      hypothesis: 'Ciclos de 12 iterações concluem o bug dentro do limite de ciclos.',
      change: { programmingPolicy: ProgrammingPolicySchema.parse({ ...current.programmingPolicy, cycle: { maxIterations: 12, noProgressLimit: 3, commandTimeoutSeconds: 600 } }) },
      requiredTools: ['workspace_replace'],
    });
    const evaluated = await runEvaluation({ evaluation: runtime.evaluation, actor: operator, datasetVersion: version, bot: current, subject: candidate.id, change: candidate.change, environment: 'simulated', workRoot: work });
    expect(evaluated.results[0]!.verdict).toBe('passed');
    // The bot itself was not touched by the evaluation.
    expect(definition(bots).programmingPolicy?.cycle.maxIterations).toBe(2);
    const comparison = runtime.evaluation.compare(operator, baseline.batch.id, evaluated.batch.id);
    expect(comparison.comparison).toMatchObject({ recommendation: 'promote', improvements: [{ caseId: 'bug-sum' }], regressions: [] });
    runtime.evaluation.approve(operator, candidate.id, 'Resolve o caso sem regressões.');
    const revision = bots.runtime('alpha').revision;
    runtime.evaluation.promote(operator, candidate.id, { availableTools: ['workspace_replace'] });
    expect(bots.runtime('alpha')).toMatchObject({ revision: revision + 1, definition: { programmingPolicy: { cycle: { maxIterations: 12 } } } });
    expect(runtime.evaluation.observe(candidate.id).recommendation).toBe('insufficient');
    const report = runtime.evaluation.report(operator, 'alpha');
    expect(report.candidates[0]).toMatchObject({ status: 'promoted', approval: { note: 'Resolve o caso sem regressões.' }, comparison: { recommendation: 'promote' } });
    runtime.evaluation.rollback(operator, candidate.id);
    expect(definition(bots).programmingPolicy?.cycle.maxIterations).toBe(2);
    for (const type of ['candidate_created', 'candidate_evaluated', 'promotion_approved', 'policy_promoted', 'policy_rolled_back', 'improvement_report_generated'])
      expect(events(runtime, type).length, type).toBeGreaterThan(0);
  }, 120_000);
});
