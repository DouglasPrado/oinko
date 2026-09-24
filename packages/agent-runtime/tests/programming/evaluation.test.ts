import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROGRAMMING_POLICY,
  EMPTY_METRICS,
  EvaluationService,
  EvaluationStore,
  ProgrammingPolicySchema,
  aggregate,
  caseFromRun,
  classifyRun,
  compare,
  datasetVersion,
  readJournal,
  type AttemptResult,
  type BotConfigPort,
  type EvaluationDataset,
  type ProgrammingPolicy,
} from '../../src/programming/index.js';
import { makeRun, openStore, tempRoot, twoBotMatrix } from './helpers.js';

const operator = { kind: 'operator' as const, id: 'ops' };
const attempt = (caseId: string, verdict: AttemptResult['verdict'], overrides: Partial<AttemptResult['metrics']> = {}, repetition = 1): AttemptResult => ({
  caseId,
  repetition,
  verdict,
  criteria: [],
  metrics: { ...EMPTY_METRICS, calls: 4, cycles: 1, tokens: { total: 1000, byRole: { main: 900, jev: 60, summary: 40 } }, cost: { confirmedUsd: 0.01, pendingCalls: 0, unavailableCalls: 0, confirmedCalls: 4 }, durationMs: 10_000, ...overrides },
  evidenceRefs: [],
  traceIds: [`trace-${caseId}-${repetition}`],
  ...(verdict !== 'passed' && { failure: { category: verdict === 'infra_failure' ? 'environment' : 'tests', code: 'x' } }),
  runId: `run-${caseId}-${repetition}`,
});

const DATASET: EvaluationDataset = {
  name: 'programming-baseline',
  description: '',
  cases: [
    {
      id: 'bug',
      title: 'Bug com teste',
      kind: 'bug_fix',
      split: 'validation',
      request: { text: 'Corrija sum', mode: 'change' },
      fixture: { files: { 'sum.cjs': 'module.exports = (a, b) => a - b;\n' } },
      criteria: [{ id: 'changes', kind: 'diff', description: 'Alterações aplicadas' }],
      expectedArtifacts: ['diff'],
      requires: [],
      interruptions: [],
      limits: { maxCycles: 5 },
    },
  ],
};

describe('M08-S02 aggregation over a known small dataset', () => {
  it('keeps infrastructure failures in the completion rate and charges failed attempts to completed cases', () => {
    const results = [attempt('a', 'passed'), attempt('a', 'failed', {}, 2), attempt('b', 'infra_failure'), attempt('b', 'passed', {}, 2), attempt('c', 'skipped')];
    const summary = aggregate(results, { minRepetitions: 2 });
    expect(summary.verdicts).toEqual({ passed: 2, failed: 1, infra_failure: 1, skipped: 1 });
    expect(summary.completionRate).toBe(0.5); // 2 of 4 executed; skipped is reported, never a success
    expect(summary.failures).toEqual({ tests: 1, environment: 1 });
    expect(summary.tokens.perCompleted).toBe(2000); // 4 executed attempts × 1000 / 2 completed
    expect(summary.tokens.byRole).toEqual({ main: 3600, jev: 240, summary: 160 });
    expect(summary.cost.perCompletedUsd).toBeCloseTo(0.02);
    expect(summary.sample.insufficient).toBe(true); // one attempt was not executed
  });

  it('never turns unknown cost into zero', () => {
    const summary = aggregate([attempt('a', 'passed', { cost: { confirmedUsd: 0, pendingCalls: 0, unavailableCalls: 3, confirmedCalls: 0 } })], { minRepetitions: 1 });
    expect(summary.cost).toMatchObject({ coverage: 'none', perCompletedUsd: null, lowerBound: true, unavailableCalls: 3 });
    const partial = aggregate([attempt('a', 'passed', { cost: { confirmedUsd: 0.01, pendingCalls: 1, unavailableCalls: 0, confirmedCalls: 3 } })], { minRepetitions: 1 });
    expect(partial.cost).toMatchObject({ coverage: 'partial', lowerBound: true });
  });

  it('never ranks a faster candidate that fails criteria as better, and flags insufficient samples', () => {
    const baseline = [1, 2, 3].map((n) => attempt('a', 'passed', { durationMs: 60_000 }, n));
    const fastButWrong = [attempt('a', 'passed', { durationMs: 5000 }, 1), attempt('a', 'failed', { durationMs: 5000 }, 2), attempt('a', 'failed', { durationMs: 5000 }, 3)];
    const result = compare({ baseline: 'd@1', candidate: 'd@1' }, baseline, fastButWrong, { minRepetitions: 3 });
    expect(result.recommendation).toBe('reject');
    expect(result.regressions).toEqual([{ caseId: 'a', baselinePassed: 3, candidatePassed: 1 }]);
    expect(result.causality).toMatch(/não prova causa/);
    expect(compare({ baseline: 'd@1', candidate: 'd@1' }, baseline.slice(0, 1), baseline.slice(0, 1), { minRepetitions: 3 }).recommendation).toBe('insufficient_evidence');
    expect(compare({ baseline: 'd@1', candidate: 'd@2' }, baseline, baseline, { minRepetitions: 3 }).recommendation).toBe('insufficient_evidence');
    const cheaper = [1, 2, 3].map((n) => attempt('a', 'passed', { tokens: { total: 500, byRole: { main: 500 } } }, n));
    expect(compare({ baseline: 'd@1', candidate: 'd@1' }, baseline, cheaper, { minRepetitions: 3 }).recommendation).toBe('promote');
  });

  it('classifies failures from observable facts', () => {
    const blocked = { state: 'blocked' as const, blocked: { code: 'no_progress', message: 'x' } };
    expect(classifyRun(blocked, [{ kind: 'check', checkKind: 'test', repositoryId: 'app', result: 'infrastructure', revision: 'r', fingerprint: 'f' }], [])?.category).toBe('environment');
    expect(classifyRun(blocked, [{ kind: 'check', checkKind: 'test', repositoryId: 'app', result: 'failed', revision: 'r', fingerprint: 'f' }], [])?.category).toBe('tests');
    expect(classifyRun(blocked, [], [{ type: 'summary_discarded' }])?.category).toBe('context');
    expect(classifyRun(blocked, [], [{ type: 'publication_blocked' }])?.category).toBe('publication');
    expect(classifyRun({ state: 'completed' }, [], [])).toBeUndefined();
  });
});

describe('M08-S01 datasets and sanitized cases', () => {
  it('versions datasets by content and never stores a changed dataset under the same version', () => {
    const version = datasetVersion(DATASET);
    expect(version).toMatch(/^programming-baseline@[0-9a-f]{16}$/);
    expect(datasetVersion({ ...DATASET })).toBe(version);
    expect(datasetVersion({ ...DATASET, cases: [{ ...DATASET.cases[0]!, request: { text: 'outro', mode: 'change' } }] })).not.toBe(version);
  });

  it('turns a real run into a case only with consent, full capture and no secret', () => {
    const access = twoBotMatrix();
    const run = makeRun(access, 'alpha', 'one', { request: { text: 'Corrigir checkout', mode: 'change', criteria: [] } });
    const options = { consent: true, id: 'checkout', title: 'Checkout', kind: 'bug_fix' as const, repository: { url: 'https://github.com/acme/app.git', commit: 'a'.repeat(40) } };
    const criteria = [{ id: 'changes', kind: 'diff' as const, description: 'Alterações' }];
    expect(caseFromRun(run, criteria, options)).toMatchObject({ id: 'checkout', split: 'tuning', fixture: { repository: { commit: 'a'.repeat(40) } } });
    expect(() => caseFromRun(run, criteria, { ...options, consent: false })).toThrow(/consentimento/);
    const secret = makeRun(access, 'alpha', 'one', { request: { text: 'use a chave sk-live-0123456789abcdefghij', mode: 'change', criteria: [] } });
    expect(() => caseFromRun(secret, criteria, options)).toThrow(/segredo/);
    access.bots.set('alpha', { ...access.bot('alpha')!, telemetry: { enabled: true, capture: 'hashed', retentionDays: 30 } });
    const hashed = makeRun(access, 'alpha', 'one');
    expect(() => caseFromRun(hashed, criteria, options)).toThrow(/captura/);
    expect(() => caseFromRun(run, criteria, { ...options, repository: { url: 'https://user:token@github.com/acme/app.git', commit: 'a'.repeat(40) } })).toThrow(/credenciais/);
  });
});

class MemoryBots implements BotConfigPort {
  revision = 1;
  config: { programmingPolicy: ProgrammingPolicy; systemPrompt: string } = { programmingPolicy: ProgrammingPolicySchema.parse({ enabled: true }), systemPrompt: 'Você programa.' };
  read() {
    return { revision: this.revision, ...this.config };
  }
  write(_botId: string, change: { programmingPolicy: ProgrammingPolicy; systemPrompt: string }, expectedRevision: number) {
    if (expectedRevision !== this.revision) throw new Error('stale');
    this.config = change;
    return { revision: ++this.revision };
  }
}

function setup() {
  const { database, store, journal } = openStore(tempRoot());
  const bots = new MemoryBots();
  const service = new EvaluationService({ store: new EvaluationStore(database), runs: store, journal, bots });
  const { version } = service.createDataset(operator, DATASET);
  const batch = (subject: string, verdicts: AttemptResult['verdict'][], tokens = 1000) => {
    const created = service.startBatch(operator, { datasetVersion: version, botId: 'alpha', subject, policyVersion: `pv-${subject}`, environment: 'simulated', repetitions: verdicts.length, manifest: { commit: 'abc', models: { main: 'm' } } });
    verdicts.forEach((verdict, index) => {
      service.caseStarted(created.id, 'bug', index + 1);
      service.caseFinished(created.id, attempt('bug', verdict, { tokens: { total: tokens, byRole: { main: tokens } } }, index + 1));
    });
    service.finishBatch(created.id);
    return created;
  };
  return { database, store, journal, bots, service, version, batch };
}
const types = (database: ReturnType<typeof setup>['database']) => readJournal(database).map((event) => event.envelope.type);

describe('M08-S03 candidates, approval, promotion and rollback', () => {
  it('promotes only an evaluated, recommended and approved candidate, then rolls back without rewriting runs', () => {
    const context = setup();
    const baseline = context.batch('baseline', ['passed', 'passed', 'passed'], 2000);
    const candidate = context.service.createCandidate(operator, {
      botId: 'alpha',
      kind: 'policy',
      hypothesis: 'Menos iterações por ciclo reduzem tokens sem perder qualidade.',
      change: { programmingPolicy: { ...DEFAULT_PROGRAMMING_POLICY, enabled: true, cycle: { maxIterations: 8, noProgressLimit: 3, commandTimeoutSeconds: 600 } } },
      requiredTools: ['workspace_patch'],
    });
    // No approval before evaluation.
    expect(() => context.service.approve(operator, candidate.id, 'ok')).toThrow(/avaliado/);
    const evaluated = context.batch(candidate.id, ['passed', 'passed', 'passed'], 1200);
    const comparison = context.service.compare(operator, baseline.id, evaluated.id);
    expect(comparison.comparison.recommendation).toBe('promote');
    expect(() => context.service.promote(operator, candidate.id, { availableTools: ['workspace_patch'] })).toThrow(/aprovação/);
    expect(() => context.service.approve({ kind: 'bot', botId: 'alpha' }, candidate.id, 'eu mesmo')).toThrow(/operador/);
    context.service.approve(operator, candidate.id, 'Economia confirmada em 3 repetições.');
    // A runtime without the tools the candidate needs refuses the promotion.
    expect(() => context.service.promote(operator, candidate.id, { availableTools: [] })).toThrow(/workspace_patch/);
    const promoted = context.service.promote(operator, candidate.id, { availableTools: ['workspace_patch'] });
    expect(promoted.status).toBe('promoted');
    expect(context.bots.config.programmingPolicy.cycle.maxIterations).toBe(8);
    const run = context.store.insertRun(makeRun(twoBotMatrix(), 'alpha', 'one'), 'h').run;
    const { affectedRuns, candidate: rolled } = context.service.rollback(operator, candidate.id);
    expect(rolled.status).toBe('rolled_back');
    expect(context.bots.config.programmingPolicy.cycle.maxIterations).toBe(12);
    expect(affectedRuns).toEqual([run.id]);
    // The run's own snapshot is untouched.
    expect(context.store.getRun(run.id)?.policySnapshot).toEqual(run.policySnapshot);
    for (const type of ['evaluation_dataset_created', 'evaluation_started', 'evaluation_case_started', 'evaluation_case_finished', 'candidate_created', 'evaluation_comparison_created', 'candidate_evaluated', 'promotion_approved', 'policy_promoted', 'policy_rolled_back'])
      expect(types(context.database), type).toContain(type);
  });

  it('keeps the current configuration when a candidate is rejected', () => {
    const context = setup();
    const baseline = context.batch('baseline', ['passed', 'passed', 'passed']);
    const before = { ...context.bots.config };
    const candidate = context.service.createCandidate(operator, { botId: 'alpha', kind: 'prompt', hypothesis: 'Prompt curto', change: { systemPrompt: 'Seja breve.' } });
    const evaluated = context.batch(candidate.id, ['passed', 'failed', 'failed'], 300);
    expect(context.service.compare(operator, baseline.id, evaluated.id).comparison.recommendation).toBe('reject');
    expect(context.service.store.candidate(candidate.id)?.status).toBe('rejected');
    expect(() => context.service.approve(operator, candidate.id, 'forçar')).toThrow();
    expect(context.bots.config).toEqual(before);
  });

  it('lets only one of two concurrent promotions win and refuses stale candidates', () => {
    const context = setup();
    const baseline = context.batch('baseline', ['passed'], 2000);
    const make = (prompt: string) => {
      const candidate = context.service.createCandidate(operator, { botId: 'alpha', kind: 'prompt', hypothesis: prompt, change: { systemPrompt: prompt } });
      context.service.compare(operator, baseline.id, context.batch(candidate.id, ['passed'], 1000).id);
      context.service.approve(operator, candidate.id, 'ok');
      return candidate;
    };
    const first = make('Versão A');
    const second = make('Versão B');
    context.service.promote(operator, first.id, { availableTools: [] });
    expect(() => context.service.promote(operator, second.id, { availableTools: [] })).toThrow(/mudou desde a criação/);
    expect(context.bots.config.systemPrompt).toBe('Versão A');
  });

  it('recommends rollback on a post-promotion regression without executing it', () => {
    const context = setup();
    const baseline = context.batch('baseline', ['passed'], 2000);
    const candidate = context.service.createCandidate(operator, { botId: 'alpha', kind: 'prompt', hypothesis: 'x', change: { systemPrompt: 'Novo' } });
    context.service.compare(operator, baseline.id, context.batch(candidate.id, ['passed'], 1000).id);
    context.service.approve(operator, candidate.id, 'ok');
    context.service.promote(operator, candidate.id, { availableTools: [] });
    const access = twoBotMatrix();
    for (let index = 0; index < 5; index++) {
      const run = context.store.insertRun(makeRun(access, 'alpha', 'one'), `h${index}`).run;
      context.store.transitionRun(run.id, run.revision, 'running', { phase: 'working' });
      const running = context.store.requireRun(run.id);
      context.store.transitionRun(run.id, running.revision, index === 0 ? 'completed' : 'failed', { phase: 'done' });
    }
    const observation = context.service.observe(candidate.id);
    expect(observation).toMatchObject({ recommendation: 'rollback', expected: 1, observed: 0.2, sample: 5 });
    expect(context.bots.config.systemPrompt).toBe('Novo');
    expect(types(context.database)).toContain('post_promotion_regression_detected');
  });
});

describe('M08-S04 reports and exports', () => {
  it('reconstructs why a version entered use and exports one bot only, redacted', () => {
    const context = setup();
    const baseline = context.batch('baseline', ['passed'], 2000);
    const candidate = context.service.createCandidate(operator, { botId: 'alpha', kind: 'prompt', hypothesis: 'Hipótese com token sk-live-0123456789abcdefghij', change: { systemPrompt: 'Novo' } });
    context.service.compare(operator, baseline.id, context.batch(candidate.id, ['passed'], 1000).id);
    const report = context.service.report(operator, 'alpha');
    expect(report.candidates[0]).toMatchObject({ id: candidate.id, status: 'evaluated', provenImprovement: true, comparison: { recommendation: 'promote' } });
    expect(report.batches).toHaveLength(2);
    // A bot sees its own history; another bot gets the same answer as a missing one.
    expect(() => context.service.report({ kind: 'bot', botId: 'beta' }, 'alpha')).toThrow(/não encontrada/);
    expect(context.service.report({ kind: 'bot', botId: 'alpha' }, 'alpha').botId).toBe('alpha');
    const exported = context.service.export(operator, 'alpha');
    expect(exported.content).not.toContain('sk-live-0123456789abcdefghij');
    expect(JSON.parse(exported.content)).toMatchObject({ schemaVersion: 1, botId: 'alpha' });
    expect(context.service.export(operator, 'beta').content).not.toContain(candidate.id);
    expect(types(context.database)).toEqual(expect.arrayContaining(['improvement_report_generated', 'evaluation_exported']));
    expect(() => context.service.createCandidate({ kind: 'bot', botId: 'alpha' }, { botId: 'alpha', kind: 'prompt', hypothesis: 'x', change: {} })).toThrow(/operador/);
  });

  it('compares bots on the same dataset version with quality next to economy', () => {
    const context = setup();
    context.batch('baseline', ['passed'], 2000);
    const result = context.service.compareBots(operator, context.version, ['alpha', 'beta']);
    expect(result.rows[0]).toMatchObject({ botId: 'alpha', aggregate: { completionRate: 1, tokens: { perCompleted: 2000 } } });
    expect(result.rows[1]).toMatchObject({ botId: 'beta', aggregate: undefined });
    expect(types(context.database)).toContain('efficiency_comparison_generated');
  });
});

describe('M08 gaps: safety, interventions, live comparison and export retention', () => {
  it('rejects a candidate that saves tokens but causes more denials or uncertain effects', () => {
    const baseline = [1, 2, 3].map((n) => attempt('a', 'passed', {}, n));
    const unsafe = [1, 2, 3].map((n) => attempt('a', 'passed', { tokens: { total: 400, byRole: { main: 400 } }, safety: { denials: 1, uncertain: 1 } }, n));
    const result = compare({ baseline: 'd@1', candidate: 'd@1' }, baseline, unsafe, { minRepetitions: 3 });
    expect(result.recommendation).toBe('reject');
    expect(result.reasons[0]).toMatch(/Segurança piorou/);
    expect(result.candidate.safety).toMatchObject({ denials: 3, uncertain: 3, perAttempt: 2 });
  });

  it('counts human interventions and shows trade-offs next to a recommended gain', () => {
    const baseline = [1, 2, 3].map((n) => attempt('a', 'passed', { durationMs: 10_000 }, n));
    const slower = [1, 2, 3].map((n) => attempt('a', 'passed', { tokens: { total: 600, byRole: { main: 600 } }, durationMs: 40_000, interventions: 1 }, n));
    const result = compare({ baseline: 'd@1', candidate: 'd@1' }, baseline, slower, { minRepetitions: 3 });
    expect(result.recommendation).toBe('promote');
    expect(result.candidate.interventions).toEqual({ total: 3, perAttempt: 1 });
    expect(result.tradeoffs).toEqual(expect.arrayContaining([expect.stringMatching(/a mais na mediana/), 'exigiu mais intervenção humana']));
  });

  it('classifies model and tool failures', () => {
    const blocked = { state: 'blocked' as const, blocked: { code: 'no_progress', message: 'x' } };
    expect(classifyRun(blocked, [], [{ type: 'model_attempt_finished', status: 'failed' }])?.category).toBe('model');
    expect(classifyRun(blocked, [{ kind: 'error', fingerprint: 'edit_conflict', message: 'conflito' }], [])?.category).toBe('tool');
  });

  it('compares live runs by bot, project, policy and model with the runs behind each number', () => {
    const context = setup();
    const access = twoBotMatrix();
    const finish = (botId: string, projectId: string, state: 'completed' | 'failed', key: string) => {
      const run = context.store.insertRun(makeRun(access, botId, projectId), key).run;
      context.store.transitionRun(run.id, run.revision, 'running', { phase: 'working' });
      context.store.transitionRun(run.id, context.store.requireRun(run.id).revision, state, { phase: 'done' });
      return run.id;
    };
    const alphaOne = finish('alpha', 'one', 'completed', 'k1');
    finish('alpha', 'two', 'failed', 'k2');
    const betaTwo = finish('beta', 'two', 'completed', 'k3');
    const usage = { metrics: () => ({ tokens: { total: 100, byModel: {} }, cost: { confirmedUsd: 0, confirmedCalls: 0, pendingCalls: 2, unavailableCalls: 0 } }) };
    const byBot = context.service.liveComparison(operator, { groupBy: 'bot', usage });
    expect(byBot.rows.find((row) => row.key === 'alpha')).toMatchObject({ runs: 2, completed: 1, completionRate: 0.5, insufficientSample: true, tokens: 200, costCoverage: 'none' });
    expect(byBot.rows.find((row) => row.key === 'beta')?.runIds).toEqual([betaTwo]);
    const byProject = context.service.liveComparison(operator, { groupBy: 'project', usage });
    expect(byProject.rows.find((row) => row.key === 'one')?.runIds).toEqual([alphaOne]);
    expect(context.service.liveComparison(operator, { groupBy: 'model' }).rows.map((row) => row.key).sort()).toEqual(['model-alpha', 'model-beta']);
    expect(context.service.liveComparison(operator, { groupBy: 'policy' }).rows).toHaveLength(3);
    expect(() => context.service.liveComparison({ kind: 'bot', botId: 'alpha' }, { groupBy: 'bot' })).toThrow(/operador/);
  });

  it('exports within retention, flags expired evidence and refuses another bot', () => {
    let now = Date.now();
    const { database, store, journal } = openStore(tempRoot(), () => now);
    const bots = new MemoryBots();
    const artifacts = { get: (id: string) => (id === 'art-expired' ? { id, expiredAt: now } : id === 'art-live' ? { id } : undefined) };
    const service = new EvaluationService({ store: new EvaluationStore(database), runs: store, journal, bots, artifacts: artifacts as never, now: () => now });
    const { version } = service.createDataset(operator, DATASET);
    const old = service.startBatch(operator, { datasetVersion: version, botId: 'alpha', subject: 'baseline', policyVersion: 'pv-old', environment: 'simulated', repetitions: 1, manifest: {} });
    service.caseFinished(old.id, { ...attempt('bug', 'passed'), evidenceRefs: ['art-expired'] });
    service.finishBatch(old.id);
    now += 40 * 86_400_000;
    const recent = service.startBatch(operator, { datasetVersion: version, botId: 'alpha', subject: 'baseline', policyVersion: 'pv-new', environment: 'simulated', repetitions: 1, manifest: {} });
    service.caseFinished(recent.id, { ...attempt('bug', 'passed'), evidenceRefs: ['art-live'] });
    service.finishBatch(recent.id);
    const all = JSON.parse(service.export(operator, 'alpha').content);
    expect(all.results.flatMap((result: { evidenceRefs: unknown[] }) => result.evidenceRefs)).toEqual(expect.arrayContaining([{ artifactId: 'art-expired', expired: true }, { artifactId: 'art-live', expired: false }]));
    const retained = JSON.parse(service.export(operator, 'alpha', { retentionDays: 30 }).content);
    expect(retained.retention).toEqual({ retentionDays: 30, omittedBatches: 1 });
    expect(retained.batches.map((batch: { id: string }) => batch.id)).toEqual([recent.id]);
    expect(() => service.export({ kind: 'bot', botId: 'beta' }, 'alpha')).toThrow(/não encontrada/);
  });
});
