import type { ProgrammingRun } from '../contracts.js';
import type { Evidence } from '../evidence.js';

export const FAILURE_CATEGORIES = ['context', 'model', 'tool', 'environment', 'tests', 'publication', 'criteria', 'other'] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];
export type Verdict = 'passed' | 'failed' | 'infra_failure' | 'skipped';

/** What one attempt of a case cost and produced. Unknown values stay unknown. */
export interface AttemptMetrics {
  durationMs?: number;
  calls: number;
  cycles: number;
  tokens: { total: number; byRole: Record<string, number> };
  cost: { confirmedUsd: number; pendingCalls: number; unavailableCalls: number; confirmedCalls: number };
  interventions: number;
  restarts: number;
  fallbacks: number;
  /** Safety incidents: permission denials and effects left uncertain. */
  safety?: { denials: number; uncertain: number };
}

export interface AttemptResult {
  caseId: string;
  repetition: number;
  verdict: Verdict;
  runId?: string;
  /** Why it did not pass (or was skipped). */
  failure?: { category: FailureCategory; code: string; phase?: string };
  criteria: { id: string; status: string }[];
  metrics: AttemptMetrics;
  evidenceRefs: string[];
  traceIds: string[];
  /** Commit of the fixture the attempt started from (reproducibility of inputs). */
  fixtureCommit?: string;
}

export const EMPTY_METRICS: AttemptMetrics = {
  calls: 0,
  cycles: 0,
  tokens: { total: 0, byRole: {} },
  cost: { confirmedUsd: 0, pendingCalls: 0, unavailableCalls: 0, confirmedCalls: 0 },
  interventions: 0,
  restarts: 0,
  fallbacks: 0,
  safety: { denials: 0, uncertain: 0 },
};

/**
 * Why a run did not meet its criteria, from observable facts only: the
 * blocking code, infrastructure check results, journaled context/model
 * failures and publication blocks. Anything else is "criteria".
 */
export function classifyRun(
  run: Pick<ProgrammingRun, 'state' | 'blocked' | 'finalOutcome'>,
  evidence: readonly Evidence[],
  events: readonly { type: string; status?: string }[],
): AttemptResult['failure'] {
  if (run.state === 'completed') return undefined;
  const code = run.blocked?.code ?? run.finalOutcome?.reason ?? run.state;
  const has = (type: string) => events.some((event) => event.type === type);
  const checks = evidence.filter((item): item is Extract<Evidence, { kind: 'check' }> => item.kind === 'check');
  const last = checks.at(-1);
  if (last?.result === 'infrastructure' || code === 'intent_not_persisted' || has('runner_unavailable'))
    return { category: 'environment', code, phase: 'check' };
  if (has('publication_blocked')) return { category: 'publication', code, phase: 'publication' };
  if (has('summary_discarded') || has('context_budget_exceeded')) return { category: 'context', code, phase: 'context' };
  if (events.some((event) => event.type === 'model_attempt_finished' && event.status === 'failed') && !checks.length)
    return { category: 'model', code, phase: 'model' };
  if (last && last.result !== 'passed') return { category: 'tests', code, phase: 'check' };
  if (evidence.some((item) => item.kind === 'error')) return { category: 'tool', code, phase: 'tool' };
  return { category: 'criteria', code };
}

const median = (values: number[]) => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const percentile = (values: number[], p: number) => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

export interface Aggregate {
  sample: { cases: number; attempts: number; executed: number; minRepetitions: number; insufficient: boolean; reasons: string[] };
  verdicts: Record<Verdict, number>;
  /** Passed over executed attempts; infrastructure failures stay in the denominator. */
  completionRate: number | null;
  failures: Partial<Record<FailureCategory, number>>;
  interventions: { total: number; perAttempt: number | null };
  restarts: number;
  fallbacks: number;
  safety: { denials: number; uncertain: number; perAttempt: number | null };
  durationMs: { median?: number; p90?: number };
  tokens: { total: number; byRole: Record<string, number>; perCompleted: number | null };
  /** Cost of every executed attempt (failed ones too) per completed case. */
  cost: {
    confirmedUsd: number;
    perCompletedUsd: number | null;
    coverage: 'complete' | 'partial' | 'none';
    /** When coverage is not complete the true cost is higher than shown. */
    lowerBound: boolean;
    pendingCalls: number;
    unavailableCalls: number;
  };
}

export function aggregate(results: readonly AttemptResult[], options: { minRepetitions?: number; minCases?: number } = {}): Aggregate {
  const minRepetitions = options.minRepetitions ?? 3;
  const minCases = options.minCases ?? 1;
  const verdicts: Record<Verdict, number> = { passed: 0, failed: 0, infra_failure: 0, skipped: 0 };
  const failures: Partial<Record<FailureCategory, number>> = {};
  const byRole: Record<string, number> = {};
  const perCase = new Map<string, number>();
  let tokens = 0;
  let confirmedUsd = 0;
  let pending = 0;
  let unavailable = 0;
  let confirmed = 0;
  let interventions = 0;
  let restarts = 0;
  let fallbacks = 0;
  let denials = 0;
  let uncertain = 0;
  const durations: number[] = [];
  for (const result of results) {
    verdicts[result.verdict]++;
    if (result.verdict === 'skipped') continue;
    perCase.set(result.caseId, (perCase.get(result.caseId) ?? 0) + 1);
    if (result.failure && result.verdict !== 'passed') failures[result.failure.category] = (failures[result.failure.category] ?? 0) + 1;
    tokens += result.metrics.tokens.total;
    for (const [role, value] of Object.entries(result.metrics.tokens.byRole)) byRole[role] = (byRole[role] ?? 0) + value;
    confirmedUsd += result.metrics.cost.confirmedUsd;
    pending += result.metrics.cost.pendingCalls;
    unavailable += result.metrics.cost.unavailableCalls;
    confirmed += result.metrics.cost.confirmedCalls;
    interventions += result.metrics.interventions;
    restarts += result.metrics.restarts;
    fallbacks += result.metrics.fallbacks;
    denials += result.metrics.safety?.denials ?? 0;
    uncertain += result.metrics.safety?.uncertain ?? 0;
    if (result.metrics.durationMs !== undefined) durations.push(result.metrics.durationMs);
  }
  const executed = results.length - verdicts.skipped;
  const cases = new Set(results.map((result) => result.caseId)).size;
  const repetitions = perCase.size ? Math.min(...perCase.values()) : 0;
  const reasons: string[] = [];
  if (!executed) reasons.push('nenhuma tentativa executada');
  if (repetitions < minRepetitions) reasons.push(`menos de ${minRepetitions} repetições por caso (${repetitions})`);
  if (perCase.size < minCases) reasons.push(`menos de ${minCases} casos executados`);
  if (verdicts.skipped) reasons.push(`${verdicts.skipped} tentativa(s) não executada(s)`);
  const calls = pending + unavailable + confirmed;
  const coverage = !calls || confirmed === calls ? (calls ? 'complete' : 'none') : confirmed ? 'partial' : 'none';
  return {
    sample: { cases, attempts: results.length, executed, minRepetitions: repetitions, insufficient: reasons.length > 0, reasons },
    verdicts,
    completionRate: executed ? verdicts.passed / executed : null,
    failures,
    interventions: { total: interventions, perAttempt: executed ? interventions / executed : null },
    restarts,
    fallbacks,
    safety: { denials, uncertain, perAttempt: executed ? (denials + uncertain) / executed : null },
    durationMs: { ...(median(durations) !== undefined && { median: median(durations) }), ...(percentile(durations, 90) !== undefined && { p90: percentile(durations, 90) }) },
    tokens: { total: tokens, byRole, perCompleted: verdicts.passed ? tokens / verdicts.passed : null },
    cost: {
      confirmedUsd,
      perCompletedUsd: verdicts.passed && confirmed ? confirmedUsd / verdicts.passed : null,
      coverage,
      lowerBound: coverage !== 'complete',
      pendingCalls: pending,
      unavailableCalls: unavailable,
    },
  };
}

export type Recommendation = 'promote' | 'reject' | 'no_gain' | 'insufficient_evidence';

export interface Comparison {
  datasetVersion: string;
  baseline: Aggregate;
  candidate: Aggregate;
  /** Cases the baseline passed more often than the candidate. */
  regressions: { caseId: string; baselinePassed: number; candidatePassed: number }[];
  improvements: { caseId: string; baselinePassed: number; candidatePassed: number }[];
  deltas: { completionRate: number | null; tokensPerCompleted: number | null; medianDurationMs: number | null; costPerCompletedUsd: number | null };
  recommendation: Recommendation;
  reasons: string[];
  tradeoffs: string[];
  /** Always stated: an observational comparison is not proof of cause. */
  causality: string;
}

const passedBy = (results: readonly AttemptResult[]) => {
  const counts = new Map<string, number>();
  for (const result of results) counts.set(result.caseId, (counts.get(result.caseId) ?? 0) + (result.verdict === 'passed' ? 1 : 0));
  return counts;
};
const delta = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : b - a);

/**
 * Quality first: a faster or cheaper candidate that fails more criteria is
 * never better. Promotion is recommended only with enough evidence, no
 * regressed case and a real gain; every trade-off is listed.
 */
export function compare(
  datasetVersion: { baseline: string; candidate: string },
  baselineResults: readonly AttemptResult[],
  candidateResults: readonly AttemptResult[],
  options: { minRepetitions?: number } = {},
): Comparison {
  const baseline = aggregate(baselineResults, options);
  const candidate = aggregate(candidateResults, options);
  const reasons: string[] = [];
  const tradeoffs: string[] = [];
  const before = passedBy(baselineResults);
  const after = passedBy(candidateResults);
  const regressions: Comparison['regressions'] = [];
  const improvements: Comparison['improvements'] = [];
  for (const caseId of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(caseId) ?? 0;
    const c = after.get(caseId) ?? 0;
    if (c < b) regressions.push({ caseId, baselinePassed: b, candidatePassed: c });
    else if (c > b) improvements.push({ caseId, baselinePassed: b, candidatePassed: c });
  }
  const deltas = {
    completionRate: delta(baseline.completionRate, candidate.completionRate),
    tokensPerCompleted: delta(baseline.tokens.perCompleted, candidate.tokens.perCompleted),
    medianDurationMs: delta(baseline.durationMs.median, candidate.durationMs.median),
    costPerCompletedUsd: delta(baseline.cost.perCompletedUsd, candidate.cost.perCompletedUsd),
  };
  let recommendation: Recommendation;
  if (datasetVersion.baseline !== datasetVersion.candidate) {
    recommendation = 'insufficient_evidence';
    reasons.push('Baseline e candidato usaram datasets diferentes; resultados não são comparáveis.');
  } else if (baseline.sample.insufficient || candidate.sample.insufficient) {
    recommendation = 'insufficient_evidence';
    reasons.push(...baseline.sample.reasons.map((reason) => `baseline: ${reason}`), ...candidate.sample.reasons.map((reason) => `candidato: ${reason}`));
  } else if (regressions.length || (deltas.completionRate ?? 0) < 0) {
    recommendation = 'reject';
    reasons.push(`Qualidade piorou${regressions.length ? ` em ${regressions.map((item) => item.caseId).join(', ')}` : ''}.`);
  } else if ((candidate.safety.perAttempt ?? 0) > (baseline.safety.perAttempt ?? 0)) {
    // More permission denials or uncertain effects is a safety regression, whatever it saves.
    recommendation = 'reject';
    reasons.push(`Segurança piorou: ${candidate.safety.denials} negativa(s) de permissão e ${candidate.safety.uncertain} efeito(s) incerto(s) contra ${baseline.safety.denials} e ${baseline.safety.uncertain} no baseline.`);
  } else {
    const quality = (deltas.completionRate ?? 0) > 0;
    const cheaper = (deltas.tokensPerCompleted ?? 0) < 0 || (deltas.costPerCompletedUsd ?? 0) < 0;
    const faster = (deltas.medianDurationMs ?? 0) < 0;
    recommendation = quality || cheaper || faster ? 'promote' : 'no_gain';
    reasons.push(recommendation === 'promote' ? 'Qualidade mantida ou melhor, sem casos regredidos, com ganho medido.' : 'Sem ganho medido de qualidade, consumo ou tempo.');
  }
  if ((deltas.tokensPerCompleted ?? 0) > 0) tradeoffs.push(`consome ${Math.round(deltas.tokensPerCompleted!)} tokens a mais por caso concluído`);
  if ((deltas.medianDurationMs ?? 0) > 0) tradeoffs.push(`leva ${Math.round(deltas.medianDurationMs! / 1000)}s a mais na mediana`);
  if (candidate.interventions.total > baseline.interventions.total) tradeoffs.push('exigiu mais intervenção humana');
  if (candidate.cost.lowerBound || baseline.cost.lowerBound) tradeoffs.push('custo com cobertura incompleta: valores são limite inferior');
  return {
    datasetVersion: datasetVersion.candidate,
    baseline,
    candidate,
    regressions,
    improvements,
    deltas,
    recommendation,
    reasons,
    tradeoffs,
    causality: `Comparação observacional em ${baseline.sample.executed} + ${candidate.sample.executed} tentativas: indica associação, não prova causa; variação do modelo e do ambiente pode explicar diferenças.`,
  };
}

export interface Opportunity {
  category: FailureCategory;
  hypothesis: string;
  affectedCases: string[];
  evidence: string[];
  confidence: 'low' | 'medium';
}

const HYPOTHESES: Record<FailureCategory, string> = {
  context: 'Resumos ou orçamento de contexto descartam informação necessária; revisar política de contexto.',
  model: 'O modelo falha antes de produzir evidência; avaliar outro modelo principal ou limite de fallback.',
  tool: 'Erros de ferramenta se repetem; revisar descrições/contratos das ferramentas envolvidas.',
  environment: 'Falhas de infraestrutura (runner, Docker, dependências) impedem validar; tratar o ambiente antes do agente.',
  tests: 'Verificações falham na revisão final; reforçar instruções de reproduzir e validar antes de concluir.',
  publication: 'Publicação bloqueada; revisar configuração da GitHub App e política do projeto.',
  criteria: 'O trabalho termina sem satisfazer critérios; revisar o prompt de ciclo e o limite de ciclos.',
  other: 'Falhas sem categoria; investigar os traces.',
};

/** Proposals only: nothing here changes a configuration. */
export function opportunities(results: readonly AttemptResult[], sample: Aggregate['sample']): Opportunity[] {
  const byCategory = new Map<FailureCategory, AttemptResult[]>();
  for (const result of results)
    if (result.verdict === 'failed' || result.verdict === 'infra_failure') {
      const category = result.failure?.category ?? 'other';
      byCategory.set(category, [...(byCategory.get(category) ?? []), result]);
    }
  return [...byCategory.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([category, items]) => ({
      category,
      hypothesis: HYPOTHESES[category],
      affectedCases: [...new Set(items.map((item) => item.caseId))],
      evidence: items.flatMap((item) => [...(item.runId ? [item.runId] : []), ...item.traceIds]).slice(0, 50),
      confidence: sample.insufficient || items.length < 2 ? 'low' : 'medium',
    }));
}
