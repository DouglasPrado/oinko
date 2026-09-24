import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/** Bumped only on incompatible changes; new optional fields keep the version. */
export const PROGRAMMING_CONTRACT_VERSION = 1;

export const BotIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const EntityIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const Timestamp = z.number().int().nonnegative();
const Json = z.record(z.string(), z.unknown());

export const RUN_STATES = [
  'queued',
  'running',
  'paused',
  'blocked',
  'completed',
  'failed',
  'cancelled',
] as const;
export const RunStateSchema = z.enum(RUN_STATES);
export type RunState = z.infer<typeof RunStateSchema>;

/** `recovering` is a phase, not a public state (ARCHITECTURE.md). */
export const RUN_PHASES = [
  'queued',
  'recovering',
  'planning',
  'working',
  'validating',
  'delivering',
  'finalizing',
  'waiting',
  'done',
] as const;
export const RunPhaseSchema = z.enum(RUN_PHASES);
export type RunPhase = z.infer<typeof RunPhaseSchema>;

/** `analysis` never modifies the project, whatever the policy allows. */
export const RunModeSchema = z.enum(['change', 'analysis']);
export type RunMode = z.infer<typeof RunModeSchema>;

export const ActorSchema = z.discriminatedUnion('kind', [
  /** Installation administrator: dashboard session or local Oinko MCP. */
  z.object({ kind: z.literal('operator'), id: z.string().min(1).max(200) }),
  /** A bot acting through its own tools or a bot-scoped MCP connection. */
  z.object({ kind: z.literal('bot'), botId: BotIdSchema }),
  /** A person talking to a bot through a channel conversation. */
  z.object({
    kind: z.literal('channel'),
    botId: BotIdSchema,
    channel: z.string().min(1).max(40),
    conversationId: z.string().min(1).max(500),
    userId: z.string().max(200).optional(),
  }),
  /** Internal executor/recovery work, always bound to one bot. */
  z.object({ kind: z.literal('system'), botId: BotIdSchema, component: z.string().min(1) }),
]);
export type Actor = z.infer<typeof ActorSchema>;

export const CriterionSchema = z.object({
  id: z.string().min(1).max(80),
  description: z.string().min(1).max(2000),
  kind: z.enum(['check', 'diff', 'functional', 'publication', 'analysis', 'manual']),
  status: z.enum(['pending', 'satisfied', 'failed', 'invalidated']).default('pending'),
  evidenceRefs: z.array(z.string()).default([]),
  /** Tree/commit the evidence refers to; a new edit invalidates older evidence. */
  revision: z.string().optional(),
});
export type Criterion = z.infer<typeof CriterionSchema>;

export const RunRequestSchema = z.object({
  text: z.string().min(1).max(200_000),
  mode: RunModeSchema.default('change'),
  criteria: z.array(CriterionSchema).max(50).default([]),
  source: z
    .object({ channel: z.string().max(40), conversationId: z.string().max(500).optional() })
    .optional(),
});
export type RunRequest = z.infer<typeof RunRequestSchema>;

export const PolicySnapshotSchema = z.object({
  /** sha256 of the canonical resolved policy: the version recorded on every event. */
  version: z.string().min(1),
  policy: Json,
});
export type PolicySnapshot = z.infer<typeof PolicySnapshotSchema>;

export const LeaseSchema = z.object({ owner: z.string().min(1), expiresAt: Timestamp });

export const BlockReasonSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1).max(4000),
  operationId: z.string().optional(),
  stepId: z.string().optional(),
  needs: z.string().max(2000).optional(),
});
export type BlockReason = z.infer<typeof BlockReasonSchema>;

/** Technical completion, a published draft PR and human acceptance are distinct facts. */
export const DeliveryLevelSchema = z.enum(['technical', 'draft_pr', 'accepted']);

export const FinalOutcomeSchema = z.object({
  outcome: z.enum(['completed', 'failed', 'cancelled']),
  summary: z.string().max(20_000),
  reason: z.string().max(4000).optional(),
  delivery: DeliveryLevelSchema.optional(),
  /** Operations still uncertain when the run stopped; reconciliation continues as audit work. */
  uncertainOperations: z.array(z.string()).default([]),
});
export type FinalOutcome = z.infer<typeof FinalOutcomeSchema>;

export const ProgrammingRunSchema = z.object({
  id: z.string().regex(/^run-[a-f0-9-]{36}$/),
  contractVersion: z.number().int().positive().default(PROGRAMMING_CONTRACT_VERSION),
  botId: BotIdSchema,
  conversationId: z.string().max(500).optional(),
  projectId: EntityIdSchema,
  taskId: EntityIdSchema.optional(),
  repositoryIds: z.array(EntityIdSchema).max(12).default([]),
  request: RunRequestSchema,
  idempotencyKey: z.string().min(1).max(200).optional(),
  state: RunStateSchema,
  phase: RunPhaseSchema,
  planRevision: z.number().int().nonnegative().default(0),
  policySnapshot: PolicySnapshotSchema,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** Compare-and-swap counter: every write states the revision it read. */
  revision: z.number().int().nonnegative().default(0),
  currentStepId: z.string().optional(),
  lease: LeaseSchema.optional(),
  cycleCount: z.number().int().nonnegative().default(0),
  noProgressCount: z.number().int().nonnegative().default(0),
  blocked: BlockReasonSchema.optional(),
  finalOutcome: FinalOutcomeSchema.optional(),
  previousRunId: z.string().optional(),
  startedAt: Timestamp.optional(),
  finishedAt: Timestamp.optional(),
});
export type ProgrammingRun = z.infer<typeof ProgrammingRunSchema>;

export const STEP_KINDS = [
  'cycle',
  'search',
  'read',
  'edit',
  'check',
  'diff',
  'preview',
  'functional_check',
  'publication',
  'reconciliation',
  'direction',
  'acceptance',
] as const;
export const RunStepSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  kind: z.enum(STEP_KINDS),
  status: z
    .enum(['pending', 'running', 'succeeded', 'failed', 'uncertain', 'skipped', 'cancelled'])
    .default('pending'),
  attempt: z.number().int().positive().default(1),
  objective: z.string().max(4000),
  inputRefs: z.array(z.string()).default([]),
  outputRefs: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  summary: z.string().max(20_000).optional(),
  traceIds: z.array(z.string()).default([]),
  createdAt: Timestamp,
  startedAt: Timestamp.optional(),
  finishedAt: Timestamp.optional(),
});
export type RunStep = z.infer<typeof RunStepSchema>;

export const OPERATION_STATES = ['intended', 'running', 'succeeded', 'failed', 'uncertain'] as const;
export const OperationStateSchema = z.enum(OPERATION_STATES);
export type OperationState = z.infer<typeof OperationStateSchema>;

export const OperationReceiptSchema = z.object({
  operationId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().optional(),
  kind: z.string().min(1).max(100),
  idempotencyKey: z.string().min(1).max(300),
  paramsHash: z.string().min(1),
  actor: ActorSchema,
  executorId: z.string().optional(),
  jobId: z.string().optional(),
  intent: Json.default({}),
  preconditions: Json.default({}),
  state: OperationStateSchema,
  resultRef: z.string().optional(),
  result: z.unknown().optional(),
  error: z
    .object({ code: z.string(), message: z.string(), retryable: z.boolean() })
    .optional(),
  observedEffects: Json.optional(),
  attempt: z.number().int().positive().default(1),
  attemptId: z.string().optional(),
  createdAt: Timestamp,
  startedAt: Timestamp.optional(),
  finishedAt: Timestamp.optional(),
  reconciledAt: Timestamp.optional(),
});
export type OperationReceipt = z.infer<typeof OperationReceiptSchema>;

export const CapturePolicySchema = z.enum(['full', 'hashed', 'none']);
export type CapturePolicy = z.infer<typeof CapturePolicySchema>;

export const ARTIFACT_TYPES = [
  'diff',
  'log',
  'screenshot',
  'report',
  'snapshot',
  'console',
  'network',
  'patch',
  'export',
] as const;
export const ArtifactSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().optional(),
  type: z.enum(ARTIFACT_TYPES),
  repositoryId: EntityIdSchema.optional(),
  commitSha: z.string().optional(),
  treeHash: z.string().optional(),
  /** Path relative to the artifact store root; never a host path returned to clients. */
  location: z.string().min(1),
  contentHash: z.string().min(1),
  size: z.number().int().nonnegative(),
  mediaType: z.string().default('text/plain'),
  capturePolicy: CapturePolicySchema,
  /** Restricted artifacts (authenticated screenshots) are never served to other bots. */
  restricted: z.boolean().default(false),
  accessScope: z.object({ botId: BotIdSchema, projectId: EntityIdSchema }),
  createdAt: Timestamp,
  expiresAt: Timestamp.optional(),
  expiredAt: Timestamp.optional(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const PublicationSchema = z.object({
  id: z.string().min(1),
  botId: BotIdSchema,
  projectId: EntityIdSchema,
  taskId: EntityIdSchema,
  repositoryId: EntityIdSchema,
  branch: z.string().min(1).max(200),
  originatingRunId: z.string().min(1),
  contributingRunIds: z.array(z.string()).default([]),
  remoteSha: z.string().optional(),
  prNumber: z.number().int().positive().optional(),
  prUrl: z.string().url().optional(),
  /** Always draft: this plan never marks a PR ready, approved or merged. */
  draft: z.literal(true).default(true),
  prState: z.enum(['open', 'closed', 'merged', 'unknown']).default('unknown'),
  checkRefs: z.array(z.string()).default([]),
  reconciliationState: z.enum(['synced', 'pending', 'uncertain', 'blocked']).default('pending'),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Publication = z.infer<typeof PublicationSchema>;

export const EvaluationSchema = z.object({
  id: z.string().min(1),
  datasetVersion: z.string().min(1),
  candidateVersion: z.string().min(1),
  baselineVersion: z.string().min(1),
  caseId: z.string().min(1),
  repetition: z.number().int().positive(),
  runId: z.string().optional(),
  environment: z.enum(['simulated', 'docker', 'real']),
  rubric: Json.default({}),
  metrics: Json.default({}),
  verdict: z.enum(['passed', 'failed', 'infra_failure', 'skipped']),
  evidenceRefs: z.array(z.string()).default([]),
  createdAt: Timestamp,
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

export const ControlKindSchema = z.enum(['pause', 'resume', 'cancel', 'steer']);
export type ControlKind = z.infer<typeof ControlKindSchema>;
export const ControlRequestSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  kind: ControlKindSchema,
  /** `requested` is only the persisted intention; the executor applies it at a safe point. */
  status: z.enum(['requested', 'applied', 'rejected', 'superseded']),
  actor: ActorSchema,
  payload: Json.default({}),
  response: Json.optional(),
  createdAt: Timestamp,
  appliedAt: Timestamp.optional(),
});
export type ControlRequest = z.infer<typeof ControlRequestSchema>;

export const PlanRevisionSchema = z.object({
  runId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  plan: z.array(z.string().max(2000)).max(100),
  objective: z.string().max(20_000),
  reason: z.string().max(4000),
  source: z.enum(['request', 'agent', 'user']),
  /** Incompatible objective changes are recorded as such and need a decision. */
  compatible: z.boolean().default(true),
  createdAt: Timestamp,
});
export type PlanRevision = z.infer<typeof PlanRevisionSchema>;

export function newRunId(): string {
  return `run-${randomUUID()}`;
}
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
