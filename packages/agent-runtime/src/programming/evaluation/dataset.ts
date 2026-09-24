import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ProgrammingRun } from '../contracts.js';
import { ProgrammingError } from '../errors.js';
import { redactText } from '../telemetry/redaction.js';

export const EVALUATION_ENVIRONMENTS = ['simulated', 'docker', 'real'] as const;
export type EvaluationEnvironment = (typeof EVALUATION_ENVIRONMENTS)[number];

const CaseId = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const ScriptStepSchema = z.union([
  z.strictObject({ tool: z.string().min(1).max(100), args: z.record(z.string(), z.unknown()).default({}) }),
  z.strictObject({ text: z.string().max(20_000) }),
]);
export type ScriptStep = z.infer<typeof ScriptStepSchema>;

const CaseCriterionSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/),
  kind: z.enum(['diff', 'check', 'functional', 'publication', 'analysis', 'manual']),
  description: z.string().min(1).max(500),
});

/**
 * One frozen scenario: inputs, repository at a pinned revision, success
 * criteria verifiable by evidence before execution, and what the run must
 * leave behind. `simulation` is a deterministic model used only by the
 * simulated environment; real providers never see it.
 */
export const EvaluationCaseSchema = z.strictObject({
  id: CaseId,
  title: z.string().min(1).max(200),
  kind: z.enum(['bug_fix', 'monorepo_feature', 'visual_change', 'long_interrupted', 'analysis', 'other']),
  /** Tuning cases shape candidates; validation cases judge them. */
  split: z.enum(['tuning', 'validation']).default('validation'),
  request: z.strictObject({
    text: z.string().min(1).max(20_000),
    mode: z.enum(['change', 'analysis']).default('change'),
  }),
  fixture: z.union([
    /** Committed with a fixed author and date: the same files give the same commit. */
    z.strictObject({ files: z.record(z.string().min(1).max(500), z.string().max(200_000)) }),
    /** A real repository pinned at one commit (sanitized cases from real failures). */
    z.strictObject({ repository: z.strictObject({ url: z.string().min(1).max(500), commit: z.string().regex(/^[0-9a-f]{40}$/) }) }),
  ]),
  criteria: z.array(CaseCriterionSchema).min(1).max(20),
  expectedArtifacts: z.array(z.enum(['diff', 'log', 'screenshot', 'report'])).default([]),
  /** Capabilities the case needs; an environment without them skips it (never passes it). */
  requires: z.array(z.enum(['docker', 'preview', 'real_provider'])).default([]),
  /** Process restarts injected after a cycle, to measure durable recovery. */
  interruptions: z.array(z.strictObject({ afterCycle: z.number().int().min(1).max(50), kind: z.literal('process_restart') })).default([]),
  limits: z.strictObject({ maxCycles: z.number().int().min(1).max(50).default(10) }).default({ maxCycles: 10 }),
  simulation: z.strictObject({ steps: z.array(ScriptStepSchema).max(300) }).optional(),
});
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;

export const EvaluationDatasetSchema = z
  .strictObject({
    name: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
    description: z.string().max(4000).default(''),
    cases: z.array(EvaluationCaseSchema).min(1).max(200),
  })
  .superRefine((dataset, ctx) => {
    const ids = dataset.cases.map((item) => item.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['cases'], message: 'IDs de caso duplicados.' });
  });
export type EvaluationDataset = z.infer<typeof EvaluationDatasetSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

/** Content address of a dataset: any change to inputs, criteria or fixtures is a new version. */
export function datasetVersion(dataset: EvaluationDataset): string {
  const digest = createHash('sha256').update(JSON.stringify(canonical(dataset))).digest('hex');
  return `${dataset.name}@${digest.slice(0, 16)}`;
}

/** Cases of one split, preserving order. */
export function casesOf(dataset: EvaluationDataset, split?: 'tuning' | 'validation'): EvaluationCase[] {
  return split ? dataset.cases.filter((item) => item.split === split) : dataset.cases;
}

/**
 * Turns a real run into a candidate case. Only with explicit consent, a
 * capture policy that allowed content, and no secret in the request: a
 * dataset never carries secrets or data the bot was not allowed to keep.
 */
export function caseFromRun(
  run: ProgrammingRun,
  criteria: readonly { id: string; kind: EvaluationCase['criteria'][number]['kind']; description: string }[],
  options: { consent: boolean; id: string; title: string; kind: EvaluationCase['kind']; repository: { url: string; commit: string }; split?: 'tuning' | 'validation' },
): EvaluationCase {
  if (!options.consent)
    throw new ProgrammingError('permission_denied', 'Transformar um trabalho real em caso exige consentimento explícito.');
  const capture = (run.policySnapshot.policy as { telemetry?: { capture?: string } }).telemetry?.capture;
  if (capture !== 'full')
    throw new ProgrammingError('permission_denied', 'A política de captura deste bot não permite guardar o conteúdo do pedido.');
  const text = run.request.text;
  if (redactText(text) !== text)
    throw new ProgrammingError('invalid_request', 'O pedido contém um possível segredo e não entra no dataset.');
  if (/[\w.-]+:[^@\s/]+@/.test(options.repository.url))
    throw new ProgrammingError('invalid_request', 'A URL do repositório não pode levar credenciais.');
  return EvaluationCaseSchema.parse({
    id: options.id,
    title: options.title,
    kind: options.kind,
    split: options.split ?? 'tuning',
    request: { text, mode: run.request.mode },
    fixture: { repository: options.repository },
    criteria: criteria.map(({ id, kind, description }) => ({ id, kind, description })),
  });
}
