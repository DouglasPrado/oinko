import { createHash, randomUUID } from 'node:crypto';
import type { Actor, ProgrammingRun } from '../contracts.js';
import { ProgrammingError } from '../errors.js';
import type { ProgrammingPolicy } from '../policy-schema.js';
import type { ProgrammingStore } from '../store/programming-store.js';
import type { ArtifactStore } from '../artifacts.js';
import type { TelemetryJournal } from '../telemetry/journal.js';
import { redactValue } from '../telemetry/redaction.js';
import { aggregate, compare, opportunities, type Aggregate, type AttemptResult, type Comparison } from './aggregate.js';
import { EvaluationDatasetSchema, datasetVersion, type EvaluationDataset, type EvaluationEnvironment } from './dataset.js';
import { EvaluationStore, type EvaluationBatch, type EvaluationCandidate, type StoredComparison } from './store.js';

/** Reads and writes the parts of a bot a candidate may change. */
export interface BotConfigPort {
  read(botId: string): { revision: number; programmingPolicy: ProgrammingPolicy; systemPrompt: string } | undefined;
  /** Compare-and-swap on the bot revision. */
  write(botId: string, change: { programmingPolicy: ProgrammingPolicy; systemPrompt: string }, expectedRevision: number): { revision: number };
}

const TERMINAL = ['completed', 'failed', 'cancelled', 'blocked'] as const;

/** Real providers vary between runs; deterministic simulations need one repetition. */
const minRepetitionsFor = (batch: Pick<EvaluationBatch, 'environment'>) => (batch.environment === 'real' ? 3 : 1);

function configVersion(change: { programmingPolicy: ProgrammingPolicy; systemPrompt: string }): string {
  return `cfg:${createHash('sha256').update(JSON.stringify(change)).digest('hex').slice(0, 16)}`;
}

/**
 * Investigate → propose → evaluate → compare → approve → promote → observe →
 * roll back. Diagnoses and comparisons never change a bot; promotion needs
 * an evaluated candidate recommended by evidence and an explicit operator
 * approval, and applies with compare-and-swap on the bot revision.
 */
export class EvaluationService {
  readonly store: EvaluationStore;
  private readonly now: () => number;

  constructor(
    private readonly options: {
      store: EvaluationStore;
      runs: ProgrammingStore;
      journal: TelemetryJournal;
      bots?: BotConfigPort;
      artifacts?: ArtifactStore;
      now?: () => number;
    },
  ) {
    this.store = options.store;
    this.now = options.now ?? Date.now;
  }

  private operator(actor: Actor): string {
    if (actor.kind !== 'operator') throw new ProgrammingError('permission_denied', 'Somente um operador administra avaliações e promoções.');
    return actor.id;
  }
  /** Operators see every bot; a bot sees only its own evaluations. */
  private readable(actor: Actor, botId: string): void {
    if (actor.kind === 'operator') return;
    if (actor.kind === 'bot' && actor.botId === botId) return;
    throw new ProgrammingError('not_found', 'Avaliação não encontrada.');
  }
  private record(type: Parameters<TelemetryJournal['record']>[0], botId: string | undefined, payload: Record<string, unknown>, status: 'info' | 'succeeded' | 'failed' | 'started' = 'info') {
    this.options.journal.record(type, { ...(botId && { botId }) }, payload, status);
  }

  // ---- datasets -------------------------------------------------------------

  createDataset(actor: Actor, input: unknown): { version: string; created: boolean; dataset: EvaluationDataset } {
    const by = this.operator(actor);
    const dataset = EvaluationDatasetSchema.parse(input);
    const version = datasetVersion(dataset);
    const created = this.store.saveDataset(version, dataset, by, this.now());
    if (created)
      this.record('evaluation_dataset_created', undefined, {
        datasetVersion: version,
        cases: dataset.cases.length,
        tuning: dataset.cases.filter((item) => item.split === 'tuning').length,
        validation: dataset.cases.filter((item) => item.split === 'validation').length,
      });
    return { version, created, dataset };
  }

  // ---- batches --------------------------------------------------------------

  startBatch(
    actor: Actor,
    input: { datasetVersion: string; botId: string; subject: string; policyVersion: string; environment: EvaluationEnvironment; repetitions: number; manifest: Record<string, unknown> },
  ): EvaluationBatch {
    this.operator(actor);
    if (!this.store.dataset(input.datasetVersion)) throw new ProgrammingError('not_found', 'Dataset inexistente.');
    if (input.subject !== 'baseline' && this.store.candidate(input.subject)?.botId !== input.botId)
      throw new ProgrammingError('not_found', 'Candidato inexistente para este bot.');
    const batch: EvaluationBatch = { id: `evb-${randomUUID()}`, ...input, status: 'running', startedAt: this.now() };
    this.store.insertBatch(batch);
    this.record('evaluation_started', input.botId, {
      datasetVersion: input.datasetVersion,
      environment: input.environment,
      subject: input.subject,
      policyVersion: input.policyVersion,
      repetitions: input.repetitions,
      batchId: batch.id,
    }, 'started');
    return batch;
  }
  caseStarted(batchId: string, caseId: string, repetition: number, runId?: string): void {
    const batch = this.requireBatch(batchId);
    this.options.journal.record('evaluation_case_started', { botId: batch.botId, ...(runId && { runId }) }, { caseId, environment: batch.environment, repetition, batchId }, 'started');
  }
  caseFinished(batchId: string, result: AttemptResult): void {
    const batch = this.requireBatch(batchId);
    this.store.addResult(batchId, `evr-${randomUUID()}`, result, this.now());
    this.options.journal.record(
      'evaluation_case_finished',
      { botId: batch.botId, ...(result.runId && { runId: result.runId }) },
      {
        caseId: result.caseId,
        verdict: result.verdict,
        environment: batch.environment,
        repetition: result.repetition,
        batchId,
        ...(result.failure && { category: result.failure.category, code: result.failure.code }),
        tokens: result.metrics.tokens.total,
        durationMs: result.metrics.durationMs ?? null,
      },
      result.verdict === 'passed' ? 'succeeded' : result.verdict === 'skipped' ? 'info' : 'failed',
    );
    if (batch.environment === 'real')
      this.options.journal.record(
        'real_evaluation_finished',
        { botId: batch.botId, ...(result.runId && { runId: result.runId }) },
        { caseId: result.caseId, verdict: result.verdict, repetition: result.repetition, batchId },
        result.verdict === 'passed' ? 'succeeded' : result.verdict === 'skipped' ? 'info' : 'failed',
      );
  }
  finishBatch(batchId: string, status: 'finished' | 'aborted' = 'finished'): Aggregate {
    const batch = this.requireBatch(batchId);
    this.store.finishBatch(batchId, status, this.now());
    const summary = aggregate(this.store.results(batchId), { minRepetitions: minRepetitionsFor(batch) });
    for (const opportunity of opportunities(this.store.results(batchId), summary.sample))
      this.record('improvement_opportunity_detected', batch.botId, {
        category: opportunity.category,
        confidence: opportunity.confidence,
        cases: opportunity.affectedCases.length,
        batchId,
      });
    return summary;
  }
  private requireBatch(id: string): EvaluationBatch {
    const batch = this.store.batch(id);
    if (!batch) throw new ProgrammingError('not_found', 'Lote de avaliação inexistente.');
    return batch;
  }

  // ---- comparison -----------------------------------------------------------

  compare(actor: Actor, baselineBatchId: string, candidateBatchId: string): StoredComparison {
    this.operator(actor);
    const baseline = this.requireBatch(baselineBatchId);
    const candidateBatch = this.requireBatch(candidateBatchId);
    if (baseline.botId !== candidateBatch.botId) throw new ProgrammingError('invalid_request', 'Compare lotes do mesmo bot; use compareBots entre bots.');
    const comparison = compare(
      { baseline: baseline.datasetVersion, candidate: candidateBatch.datasetVersion },
      this.store.results(baselineBatchId),
      this.store.results(candidateBatchId),
      // Real providers vary between runs: three repetitions per case before any verdict.
      { minRepetitions: Math.max(minRepetitionsFor(baseline), minRepetitionsFor(candidateBatch)) },
    );
    const stored: StoredComparison = {
      id: `evc-${randomUUID()}`,
      baselineBatch: baselineBatchId,
      candidateBatch: candidateBatchId,
      ...(candidateBatch.subject !== 'baseline' && { candidateId: candidateBatch.subject }),
      comparison,
      createdAt: this.now(),
    };
    this.store.insertComparison(stored);
    this.record('evaluation_comparison_created', baseline.botId, {
      baselineVersion: baseline.policyVersion,
      candidateVersion: candidateBatch.policyVersion,
      recommendation: comparison.recommendation,
      datasetVersion: comparison.datasetVersion,
      regressions: comparison.regressions.length,
      comparisonId: stored.id,
    });
    const candidate = stored.candidateId ? this.store.candidate(stored.candidateId) : undefined;
    if (candidate && (candidate.status === 'draft' || candidate.status === 'evaluated')) {
      const status = comparison.recommendation === 'reject' ? 'rejected' : 'evaluated';
      this.store.updateCandidate(
        { ...candidate, status, evaluation: { comparisonId: stored.id, recommendation: comparison.recommendation, batchId: candidateBatchId }, updatedAt: this.now() },
        candidate.revision,
      );
      this.record('candidate_evaluated', candidate.botId, { candidateId: candidate.id, verdict: comparison.recommendation, comparisonId: stored.id });
    }
    return stored;
  }

  /** Efficiency of different bots on the same dataset version, quality shown next to economy. */
  compareBots(actor: Actor, datasetVersion: string, botIds: readonly string[]) {
    this.operator(actor);
    const rows = botIds.map((botId) => {
      const batch = this.store.batches({ botId, datasetVersion }).find((item) => item.status === 'finished');
      return { botId, batchId: batch?.id, policyVersion: batch?.policyVersion, environment: batch?.environment, aggregate: batch ? aggregate(this.store.results(batch.id), { minRepetitions: minRepetitionsFor(batch) }) : undefined };
    });
    this.record('efficiency_comparison_generated', undefined, { datasetVersion, bots: botIds.length, measured: rows.filter((row) => row.aggregate).length });
    return { datasetVersion, rows, note: 'Mesma versão de dataset para todos; bots sem lote concluído aparecem sem números.' };
  }

  // ---- candidates -----------------------------------------------------------

  createCandidate(
    actor: Actor,
    input: { botId: string; kind: EvaluationCandidate['kind']; hypothesis: string; change: { programmingPolicy?: ProgrammingPolicy; systemPrompt?: string }; requiredTools?: string[] },
  ): EvaluationCandidate {
    const by = this.operator(actor);
    const current = this.bots().read(input.botId);
    if (!current) throw new ProgrammingError('not_found', 'Bot inexistente.');
    const now = this.now();
    const candidate: EvaluationCandidate = {
      id: `cand-${randomUUID()}`,
      botId: input.botId,
      kind: input.kind,
      hypothesis: input.hypothesis,
      change: { programmingPolicy: input.change.programmingPolicy ?? current.programmingPolicy, systemPrompt: input.change.systemPrompt ?? current.systemPrompt },
      requiredTools: input.requiredTools ?? [],
      base: { botRevision: current.revision, programmingPolicy: current.programmingPolicy, systemPrompt: current.systemPrompt },
      status: 'draft',
      observations: [],
      createdBy: by,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    this.store.insertCandidate(candidate);
    this.record('candidate_created', input.botId, { candidateId: candidate.id, kind: input.kind, version: configVersion(candidate.change) });
    return candidate;
  }

  approve(actor: Actor, candidateId: string, note: string): EvaluationCandidate {
    const by = this.operator(actor);
    const candidate = this.requireCandidate(candidateId);
    if (candidate.status !== 'evaluated')
      throw new ProgrammingError('invalid_transition', 'Só um candidato avaliado e não reprovado pode ser aprovado.');
    if (candidate.evaluation?.recommendation !== 'promote')
      throw new ProgrammingError('invalid_transition', `A avaliação não recomenda promover (${candidate.evaluation?.recommendation ?? 'sem avaliação'}).`);
    const approved = this.store.updateCandidate({ ...candidate, status: 'approved', approval: { by, at: this.now(), note }, updatedAt: this.now() }, candidate.revision);
    this.record('promotion_approved', candidate.botId, { candidateId, approvedBy: by });
    return approved;
  }

  promote(actor: Actor, candidateId: string, runtime: { availableTools: readonly string[] }): EvaluationCandidate {
    const by = this.operator(actor);
    const candidate = this.requireCandidate(candidateId);
    if (candidate.status !== 'approved') throw new ProgrammingError('invalid_transition', 'Promoção exige aprovação explícita registrada.');
    const missing = candidate.requiredTools.filter((tool) => !runtime.availableTools.includes(tool));
    if (missing.length)
      throw new ProgrammingError('invalid_request', `O runtime atual não tem as ferramentas exigidas: ${missing.join(', ')}.`, { details: { missing } });
    const current = this.bots().read(candidate.botId);
    if (!current || current.revision !== candidate.base.botRevision)
      throw new ProgrammingError('revision_conflict', 'A configuração do bot mudou desde a criação do candidato; crie e avalie um novo candidato.');
    // The candidate row is claimed first: a concurrent promotion loses here.
    const claimed = this.store.updateCandidate({ ...candidate, updatedAt: this.now() }, candidate.revision);
    const written = this.bots().write(candidate.botId, candidate.change, current.revision);
    const version = configVersion(candidate.change);
    const promoted = this.store.updateCandidate(
      { ...claimed, status: 'promoted', promotion: { by, at: this.now(), botRevision: written.revision, version }, updatedAt: this.now() },
      claimed.revision,
    );
    this.record('policy_promoted', candidate.botId, { candidateId, version, botRevision: written.revision });
    return promoted;
  }

  /**
   * Restores the configuration the candidate replaced. Runs keep their
   * policy snapshots; the affected ones are listed, history is untouched.
   */
  rollback(actor: Actor, candidateId: string): { candidate: EvaluationCandidate; affectedRuns: string[] } {
    const by = this.operator(actor);
    const candidate = this.requireCandidate(candidateId);
    if (candidate.status !== 'promoted' || !candidate.promotion) throw new ProgrammingError('invalid_transition', 'Só um candidato promovido pode ser revertido.');
    const current = this.bots().read(candidate.botId);
    if (!current) throw new ProgrammingError('not_found', 'Bot inexistente.');
    if (configVersion({ programmingPolicy: current.programmingPolicy, systemPrompt: current.systemPrompt }) !== candidate.promotion.version)
      throw new ProgrammingError('revision_conflict', 'A configuração foi alterada depois da promoção; reverta manualmente para não descartar essa alteração.');
    const written = this.bots().write(candidate.botId, { programmingPolicy: candidate.base.programmingPolicy, systemPrompt: candidate.base.systemPrompt }, current.revision);
    const affectedRuns = this.runsSince(candidate.botId, candidate.promotion.at).map((run) => run.id);
    const rolled = this.store.updateCandidate(
      { ...candidate, status: 'rolled_back', rollback: { by, at: this.now(), botRevision: written.revision, affectedRuns }, updatedAt: this.now() },
      candidate.revision,
    );
    this.record('policy_rolled_back', candidate.botId, { candidateId, toVersion: configVersion(candidate.base), affectedRuns: affectedRuns.length });
    return { candidate: rolled, affectedRuns };
  }

  /**
   * Live runs after promotion against the evaluated completion rate. A
   * regression produces a rollback recommendation, never a rollback.
   */
  observe(candidateId: string, options: { minRuns?: number; tolerance?: number } = {}): EvaluationCandidate['observations'][number] {
    const candidate = this.requireCandidate(candidateId);
    if (candidate.status !== 'promoted' || !candidate.promotion || !candidate.evaluation) throw new ProgrammingError('invalid_transition', 'Só candidatos promovidos são acompanhados.');
    const comparison = this.store.comparison(candidate.evaluation.comparisonId);
    const expected = comparison?.comparison.candidate.completionRate ?? null;
    const runs = this.runsSince(candidate.botId, candidate.promotion.at).filter((run) => (TERMINAL as readonly string[]).includes(run.state));
    const observed = runs.length ? runs.filter((run) => run.state === 'completed').length / runs.length : null;
    const minRuns = options.minRuns ?? 5;
    const tolerance = options.tolerance ?? 0.1;
    const recommendation: 'keep' | 'rollback' | 'insufficient' =
      runs.length < minRuns || expected === null || observed === null ? 'insufficient' : observed < expected - tolerance ? 'rollback' : 'keep';
    const observation = { at: this.now(), metric: 'completion_rate', expected, observed, sample: runs.length, recommendation };
    this.store.updateCandidate({ ...candidate, observations: [...candidate.observations, observation], updatedAt: this.now() }, candidate.revision);
    if (recommendation === 'rollback')
      this.record('post_promotion_regression_detected', candidate.botId, { candidateId, metric: 'completion_rate', expected, observed, sample: runs.length }, 'failed');
    return observation;
  }

  private runsSince(botId: string, since: number): ProgrammingRun[] {
    const items: ProgrammingRun[] = [];
    let cursor: string | undefined;
    do {
      const page = this.options.runs.listRuns({ botId, createdAfter: since, limit: 100, ...(cursor && { cursor }) });
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }
  private requireCandidate(id: string): EvaluationCandidate {
    const candidate = this.store.candidate(id);
    if (!candidate) throw new ProgrammingError('not_found', 'Candidato inexistente.');
    return candidate;
  }
  private bots(): BotConfigPort {
    if (!this.options.bots) throw new ProgrammingError('unavailable', 'Configuração de bots indisponível neste processo.');
    return this.options.bots;
  }

  // ---- reports ----------------------------------------------------------------

  /** Why each version entered (or left) use, with the evidence behind it. */
  report(actor: Actor, botId: string) {
    this.readable(actor, botId);
    const batches = this.store.batches({ botId });
    const comparisons = this.store.comparisons(batches.map((batch) => batch.id));
    const latest = batches.find((batch) => batch.status === 'finished');
    const latestResults = latest ? this.store.results(latest.id) : [];
    const latestAggregate = latest ? aggregate(latestResults, { minRepetitions: minRepetitionsFor(latest) }) : undefined;
    const report = {
      botId,
      generatedAt: this.now(),
      candidates: this.store.candidates(botId).map((candidate) => ({
        ...candidate,
        comparison: candidate.evaluation ? comparisons.find((item) => item.id === candidate.evaluation!.comparisonId)?.comparison : undefined,
        provenImprovement: candidate.evaluation?.recommendation === 'promote',
      })),
      batches: batches.map((batch) => ({ ...batch, aggregate: aggregate(this.store.results(batch.id), { minRepetitions: minRepetitionsFor(batch) }) })),
      comparisons,
      opportunities: latest && latestAggregate ? opportunities(latestResults, latestAggregate.sample) : [],
    };
    this.record('improvement_report_generated', botId, { scope: 'bot', candidates: report.candidates.length, batches: batches.length });
    return report;
  }

  /** Redacted export of one bot's evaluation history; never mixes bots. */
  export(actor: Actor, botId: string): { format: 'json'; content: string } {
    const report = this.report(actor, botId);
    const results = report.batches.flatMap((batch) =>
      this.store.results(batch.id).map((result) => ({
        batchId: batch.id,
        ...result,
        evidenceRefs: result.evidenceRefs.map((ref) => {
          const artifact = this.options.artifacts?.get(ref);
          return artifact ? { artifactId: ref, expired: !!artifact.expiredAt } : { ref };
        }),
      })),
    );
    const content = JSON.stringify(redactValue({ schemaVersion: 1, ...report, results }), null, 2);
    this.record('evaluation_exported', botId, { scope: 'bot', format: 'json', bytes: content.length });
    return { format: 'json', content };
  }
}

export type { Comparison };
