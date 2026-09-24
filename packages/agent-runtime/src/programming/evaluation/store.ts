import { z } from 'zod';
import { ProgrammingError } from '../errors.js';
import type { ProgrammingDatabase } from '../store/database.js';
import { ProgrammingPolicySchema } from '../policy-schema.js';
import { EVALUATION_ENVIRONMENTS, EvaluationDatasetSchema, type EvaluationDataset } from './dataset.js';
import type { AttemptResult, Comparison } from './aggregate.js';

type Row = Record<string, unknown>;

export const EvaluationBatchSchema = z.object({
  id: z.string().min(1),
  datasetVersion: z.string().min(1),
  botId: z.string().min(1),
  /** `baseline` or a candidate id. */
  subject: z.string().min(1),
  policyVersion: z.string().min(1),
  environment: z.enum(EVALUATION_ENVIRONMENTS),
  repetitions: z.number().int().positive(),
  /** Models, configuration, commit, date: what makes the numbers reproducible. */
  manifest: z.record(z.string(), z.unknown()),
  status: z.enum(['running', 'finished', 'aborted']),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
});
export type EvaluationBatch = z.infer<typeof EvaluationBatchSchema>;

const Change = z.object({ programmingPolicy: ProgrammingPolicySchema, systemPrompt: z.string().max(40_000) });
export const EvaluationCandidateSchema = z.object({
  id: z.string().min(1),
  botId: z.string().min(1),
  kind: z.enum(['policy', 'prompt', 'model', 'tool']),
  hypothesis: z.string().min(1).max(4000),
  change: Change,
  /** Tools the candidate relies on; promotion refuses a runtime without them. */
  requiredTools: z.array(z.string().min(1).max(100)).max(100).default([]),
  base: Change.extend({ botRevision: z.number().int().nonnegative() }),
  status: z.enum(['draft', 'evaluated', 'approved', 'rejected', 'promoted', 'rolled_back']),
  evaluation: z.object({ comparisonId: z.string(), recommendation: z.string(), batchId: z.string() }).optional(),
  approval: z.object({ by: z.string(), at: z.number(), note: z.string() }).optional(),
  promotion: z.object({ by: z.string(), at: z.number(), botRevision: z.number().int(), version: z.string() }).optional(),
  rollback: z.object({ by: z.string(), at: z.number(), botRevision: z.number().int(), affectedRuns: z.array(z.string()) }).optional(),
  observations: z
    .array(z.object({ at: z.number(), metric: z.string(), expected: z.number().nullable(), observed: z.number().nullable(), sample: z.number(), recommendation: z.enum(['keep', 'rollback', 'insufficient']) }))
    .default([]),
  createdBy: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  revision: z.number().int().positive(),
});
export type EvaluationCandidate = z.infer<typeof EvaluationCandidateSchema>;

export interface StoredComparison {
  id: string;
  baselineBatch: string;
  candidateBatch: string;
  candidateId?: string;
  comparison: Comparison;
  createdAt: number;
}

/** Evaluation records live next to the runs they explain, in programming.db. */
export class EvaluationStore {
  constructor(private readonly database: ProgrammingDatabase) {}
  private get db() {
    return this.database.db;
  }

  saveDataset(version: string, dataset: EvaluationDataset, createdBy: string, now: number): boolean {
    const result = this.db
      .prepare('INSERT OR IGNORE INTO evaluation_datasets (version, name, dataset_json, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(version, dataset.name, JSON.stringify(dataset), createdBy, now);
    return Number(result.changes) === 1;
  }
  dataset(version: string): EvaluationDataset | undefined {
    const row = this.db.prepare('SELECT dataset_json FROM evaluation_datasets WHERE version = ?').get(version) as Row | undefined;
    return row ? EvaluationDatasetSchema.parse(JSON.parse(String(row.dataset_json))) : undefined;
  }
  datasets(): { version: string; name: string; createdAt: number; cases: number }[] {
    return (this.db.prepare('SELECT version, name, created_at, dataset_json FROM evaluation_datasets ORDER BY created_at DESC').all() as Row[]).map((row) => ({
      version: String(row.version),
      name: String(row.name),
      createdAt: Number(row.created_at),
      cases: (JSON.parse(String(row.dataset_json)) as { cases: unknown[] }).cases.length,
    }));
  }

  insertBatch(batch: EvaluationBatch): void {
    const value = EvaluationBatchSchema.parse(batch);
    this.db
      .prepare(
        `INSERT INTO evaluation_batches (id, dataset_version, bot_id, subject, policy_version, environment, repetitions, manifest_json, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(value.id, value.datasetVersion, value.botId, value.subject, value.policyVersion, value.environment, value.repetitions, JSON.stringify(value.manifest), value.status, value.startedAt);
  }
  finishBatch(id: string, status: 'finished' | 'aborted', now: number): void {
    this.db.prepare('UPDATE evaluation_batches SET status = ?, finished_at = ? WHERE id = ?').run(status, now, id);
  }
  batch(id: string): EvaluationBatch | undefined {
    const row = this.db.prepare('SELECT * FROM evaluation_batches WHERE id = ?').get(id) as Row | undefined;
    return row ? batchFromRow(row) : undefined;
  }
  batches(filter: { botId?: string; datasetVersion?: string } = {}): EvaluationBatch[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.botId) {
      where.push('bot_id = ?');
      params.push(filter.botId);
    }
    if (filter.datasetVersion) {
      where.push('dataset_version = ?');
      params.push(filter.datasetVersion);
    }
    return (
      this.db.prepare(`SELECT * FROM evaluation_batches ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY started_at DESC, rowid DESC`).all(...params) as Row[]
    ).map(batchFromRow);
  }

  addResult(batchId: string, id: string, result: AttemptResult, now: number): boolean {
    const outcome = this.db
      .prepare(
        `INSERT OR IGNORE INTO evaluation_results (id, batch_id, case_id, repetition, run_id, verdict, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, batchId, result.caseId, result.repetition, result.runId ?? null, result.verdict, JSON.stringify(result), now);
    return Number(outcome.changes) === 1;
  }
  results(batchId: string): AttemptResult[] {
    return (this.db.prepare('SELECT result_json FROM evaluation_results WHERE batch_id = ? ORDER BY case_id, repetition').all(batchId) as Row[]).map(
      (row) => JSON.parse(String(row.result_json)) as AttemptResult,
    );
  }

  insertCandidate(candidate: EvaluationCandidate): void {
    const value = EvaluationCandidateSchema.parse(candidate);
    this.db
      .prepare('INSERT INTO evaluation_candidates (id, bot_id, kind, status, revision, candidate_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(value.id, value.botId, value.kind, value.status, value.revision, JSON.stringify(value), value.createdAt, value.updatedAt);
  }
  /** Compare-and-swap on the candidate revision: two approvals or promotions cannot both win. */
  updateCandidate(candidate: EvaluationCandidate, expectedRevision: number): EvaluationCandidate {
    const next = EvaluationCandidateSchema.parse({ ...candidate, revision: expectedRevision + 1 });
    const result = this.db
      .prepare('UPDATE evaluation_candidates SET status = ?, revision = ?, candidate_json = ?, updated_at = ? WHERE id = ? AND revision = ?')
      .run(next.status, next.revision, JSON.stringify(next), next.updatedAt, next.id, expectedRevision);
    if (Number(result.changes) !== 1) throw new ProgrammingError('revision_conflict', 'O candidato foi alterado por outra operação; recarregue.');
    return next;
  }
  candidate(id: string): EvaluationCandidate | undefined {
    const row = this.db.prepare('SELECT candidate_json FROM evaluation_candidates WHERE id = ?').get(id) as Row | undefined;
    return row ? EvaluationCandidateSchema.parse(JSON.parse(String(row.candidate_json))) : undefined;
  }
  candidates(botId: string): EvaluationCandidate[] {
    return (this.db.prepare('SELECT candidate_json FROM evaluation_candidates WHERE bot_id = ? ORDER BY created_at DESC, rowid DESC').all(botId) as Row[]).map((row) =>
      EvaluationCandidateSchema.parse(JSON.parse(String(row.candidate_json))),
    );
  }

  insertComparison(value: StoredComparison): void {
    this.db
      .prepare('INSERT INTO evaluation_comparisons (id, baseline_batch, candidate_batch, candidate_id, comparison_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(value.id, value.baselineBatch, value.candidateBatch, value.candidateId ?? null, JSON.stringify(value.comparison), value.createdAt);
  }
  comparison(id: string): StoredComparison | undefined {
    const row = this.db.prepare('SELECT * FROM evaluation_comparisons WHERE id = ?').get(id) as Row | undefined;
    return row ? comparisonFromRow(row) : undefined;
  }
  comparisons(batchIds: readonly string[]): StoredComparison[] {
    if (!batchIds.length) return [];
    const marks = batchIds.map(() => '?').join(',');
    return (
      this.db.prepare(`SELECT * FROM evaluation_comparisons WHERE candidate_batch IN (${marks}) OR baseline_batch IN (${marks}) ORDER BY created_at DESC`).all(...batchIds, ...batchIds) as Row[]
    ).map(comparisonFromRow);
  }
}

function batchFromRow(row: Row): EvaluationBatch {
  return EvaluationBatchSchema.parse({
    id: row.id,
    datasetVersion: row.dataset_version,
    botId: row.bot_id,
    subject: row.subject,
    policyVersion: row.policy_version,
    environment: row.environment,
    repetitions: row.repetitions,
    manifest: JSON.parse(String(row.manifest_json)),
    status: row.status,
    startedAt: row.started_at,
    ...(row.finished_at !== null && { finishedAt: row.finished_at }),
  });
}
function comparisonFromRow(row: Row): StoredComparison {
  return {
    id: String(row.id),
    baselineBatch: String(row.baseline_batch),
    candidateBatch: String(row.candidate_batch),
    ...(row.candidate_id !== null && { candidateId: String(row.candidate_id) }),
    comparison: JSON.parse(String(row.comparison_json)) as Comparison,
    createdAt: Number(row.created_at),
  };
}
