import { z } from 'zod';

/**
 * Versioned event catalog (TELEMETRY.md). `safe` lists categorical string
 * fields (enums, identifiers, model names) that survive capture `none` and
 * `hashed`: they describe what happened without carrying user content.
 * Numbers and booleans are always kept.
 */
export interface CatalogEntry {
  category: string;
  safe: readonly string[];
  payload: z.ZodType<Record<string, unknown>>;
  example?: Record<string, unknown>;
}

const Loose = z.record(z.string(), z.unknown());
function entry(
  category: string,
  safe: readonly string[] = [],
  shape?: z.ZodRawShape,
  example?: Record<string, unknown>,
): CatalogEntry {
  return {
    category,
    safe,
    payload: (shape ? z.looseObject(shape) : Loose) as z.ZodType<Record<string, unknown>>,
    ...(example && { example }),
  };
}
const TRANSITION = ['from', 'to', 'phase', 'reason', 'code'];
const OPERATION = ['kind', 'state', 'class', 'code', 'executorId', 'jobId', 'reason'];

export const TELEMETRY_CATALOG = {
  // Run lifecycle
  run_created: entry('run', ['mode', 'state', 'phase'], { mode: z.string() }, { mode: 'change' }),
  run_state_changed: entry('run', TRANSITION, { from: z.string(), to: z.string() }, { from: 'queued', to: 'running' }),
  run_queued: entry('run', ['state'], { position: z.number() }, { position: 0 }),
  run_dispatched: entry('run', ['owner']),
  request_deduplicated: entry('run', ['existingRunId']),
  queue_wait_measured: entry('run', [], { waitMs: z.number() }, { waitMs: 0 }),
  run_blocked: entry('run', ['code', 'reason'], { code: z.string() }, { code: 'no_progress' }),
  run_resumed: entry('run', ['reason', 'actorKind']),
  run_paused: entry('run', ['reason', 'actorKind']),
  run_cancelled: entry('run', ['reason', 'actorKind']),
  run_completed: entry('run', ['outcome', 'delivery'], { outcome: z.string() }, { outcome: 'completed' }),
  run_observed: entry('run', ['interface', 'actorKind']),
  checkpoint_saved: entry('run', ['phase', 'reason']),
  step_created: entry('run', ['kind', 'status'], { kind: z.string() }, { kind: 'cycle' }),
  // Policy and access
  policy_resolved: entry('policy', ['mode', 'autonomy'], { version: z.string() }, { version: 'sha256:x' }),
  permission_checked: entry('policy', ['class', 'operation', 'decision']),
  permission_denied: entry('policy', ['class', 'operation', 'code'], { code: z.string() }, { code: 'permission_denied' }),
  capability_changed: entry('policy', ['capability', 'action', 'actorKind']),
  bot_configuration_changed: entry('policy', ['actorKind', 'fields']),
  project_configuration_changed: entry('policy', ['actorKind', 'fields']),
  model_policy_changed: entry('policy', ['actorKind', 'main', 'fast']),
  // Migration
  migration_started: entry('migration', ['database'], { database: z.string() }, { database: 'programming' }),
  migration_finished: entry('migration', ['database', 'result']),
  // Spans and declared decisions
  telemetry_span_started: entry('span', ['name'], { name: z.string() }, { name: 'cycle' }),
  telemetry_span_finished: entry('span', ['name'], { name: z.string() }, { name: 'cycle' }),
  decision_recorded: entry('span', ['point', 'choice'], { point: z.string() }, { point: 'plan' }),
  // Operations with effects
  operation_intended: entry('operation', OPERATION, { kind: z.string() }, { kind: 'workspace.replace' }),
  operation_finished: entry('operation', OPERATION, { kind: z.string(), state: z.string() }, { kind: 'workspace.replace', state: 'succeeded' }),
  operation_uncertain: entry('operation', OPERATION, { kind: z.string() }, { kind: 'workspace.replace' }),
  operation_reconciled: entry('operation', [...OPERATION, 'resolution'], { resolution: z.string() }, { resolution: 'applied' }),
  process_terminated: entry('operation', ['signal', 'escalated']),
  // Delivery
  telemetry_delivery_degraded: entry('delivery', ['target', 'code'], { pending: z.number() }, { pending: 1 }),
  telemetry_recovered: entry('delivery', ['target'], { delivered: z.number() }, { delivered: 1 }),
  // Artifacts
  artifact_created: entry('artifact', ['artifactId', 'type', 'capture', 'mediaType'], { artifactId: z.string() }, { artifactId: 'art-1' }),
  artifact_accessed: entry('artifact', ['artifactId', 'type', 'interface', 'result']),
  artifact_expired: entry('artifact', ['artifactId', 'type', 'reason']),
  capture_policy_applied: entry('artifact', ['capture'], { capture: z.string() }, { capture: 'full' }),
  evidence_opened: entry('artifact', ['artifactId', 'interface']),
  evidence_invalidated: entry('artifact', ['criterionId', 'reason', 'revision']),
  // Usage
  usage_reported: entry('usage', ['callId', 'role', 'model', 'costStatus'], { callId: z.string() }, { callId: 'call-1' }),
  usage_reconciled: entry('usage', ['callId', 'costStatus']),
  run_metrics_updated: entry('usage', ['costCoverage']),
  // Query
  telemetry_query: entry('query', ['interface', 'scope', 'actorKind']),
  // Workspace
  workspace_search: entry('workspace', ['kind', 'repositoryId', 'truncatedReason', 'outcome']),
  workspace_read: entry('workspace', ['repositoryId', 'hash', 'truncatedReason']),
  workspace_edit_intended: entry('workspace', ['repositoryId', 'kind']),
  workspace_edit_finished: entry('workspace', ['repositoryId', 'kind', 'state']),
  workspace_edit_conflict: entry('workspace', ['repositoryId', 'code']),
  project_instructions_resolved: entry('workspace', ['repositoryId']),
  project_commands_discovered: entry('workspace', ['repositoryId']),
  git_diff_captured: entry('workspace', ['repositoryId', 'treeHash', 'baseSha']),
  check_started: entry('workspace', ['kind', 'repositoryId', 'origin', 'revision', 'jobId']),
  check_finished: entry('workspace', ['kind', 'repositoryId', 'result', 'classification', 'revision', 'jobId']),
  // Cycles
  cycle_started: entry('cycle', ['phase'], { cycle: z.number() }, { cycle: 1 }),
  progress_assessed: entry('cycle', ['verdict'], { progressed: z.boolean() }, { progressed: true }),
  cycle_continued: entry('cycle', ['reason']),
  recovery_started: entry('cycle', ['reason', 'owner']),
  recovery_blocked: entry('cycle', ['code', 'operationKind']),
  // Control
  control_requested: entry('control', ['kind', 'status', 'interface', 'actorKind'], { kind: z.string() }, { kind: 'pause' }),
  user_direction_received: entry('control', ['interface', 'actorKind']),
  plan_revised: entry('control', ['source', 'compatible'], { revision: z.number() }, { revision: 1 }),
  acceptance_evaluated: entry('control', ['verdict'], { satisfied: z.number(), total: z.number() }, { satisfied: 1, total: 1 }),
  // Channels and MCP
  channel_request_received: entry('channel', ['channel', 'kind']),
  progress_notification_sent: entry('channel', ['channel', 'kind']),
  notification_failed: entry('channel', ['channel', 'kind', 'code']),
  mcp_call_started: entry('channel', ['tool', 'actorKind']),
  mcp_call_finished: entry('channel', ['tool', 'actorKind', 'result']),
  // Browser
  browser_session_created: entry('browser', ['sessionId', 'context', 'image']),
  browser_session_closed: entry('browser', ['sessionId', 'reason']),
  browser_session_failed: entry('browser', ['sessionId', 'code']),
  browser_navigation_allowed: entry('browser', ['sessionId', 'origin', 'rule']),
  browser_navigation_denied: entry('browser', ['sessionId', 'origin', 'rule', 'code']),
  test_credential_used: entry('browser', ['sessionId', 'credential']),
  browser_action_started: entry('browser', ['sessionId', 'action']),
  browser_action_finished: entry('browser', ['sessionId', 'action', 'result']),
  browser_console_error: entry('browser', ['sessionId', 'level']),
  browser_network_error: entry('browser', ['sessionId', 'status', 'origin']),
  // Preview
  preview_started: entry('preview', ['previewId', 'environmentId', 'revision']),
  preview_ready: entry('preview', ['previewId', 'revision']),
  preview_failed: entry('preview', ['previewId', 'code']),
  functional_check_finished: entry('preview', ['criterionId', 'result', 'revision', 'viewport']),
  // GitHub
  github_installation_checked: entry('github', ['installationId', 'result']),
  github_token_issued: entry('github', ['installationId', 'repository']),
  github_permission_denied: entry('github', ['installationId', 'repository', 'code']),
  publication_reviewed: entry('github', ['repositoryId', 'treeHash', 'verdict']),
  git_commit_created: entry('github', ['repositoryId', 'sha']),
  git_push_started: entry('github', ['repositoryId', 'branch', 'sha']),
  git_push_finished: entry('github', ['repositoryId', 'branch', 'sha', 'result']),
  pull_request_reconciled: entry('github', ['repositoryId', 'resolution', 'prState']),
  draft_pull_request_created: entry('github', ['repositoryId', 'prNumber']),
  draft_pull_request_updated: entry('github', ['repositoryId', 'prNumber']),
  publication_blocked: entry('github', ['repositoryId', 'code']),
  ci_poll_finished: entry('github', ['repositoryId', 'sha', 'overall']),
  ci_check_updated: entry('github', ['repositoryId', 'sha', 'check', 'status']),
  ci_status_unavailable: entry('github', ['repositoryId', 'sha', 'code']),
  // Context and models
  summary_scheduled: entry('context', ['reason']),
  summary_finished: entry('context', ['result']),
  summary_discarded: entry('context', ['reason']),
  context_preparation_pending: entry('context', ['reason']),
  routing_decision: entry('context', ['model', 'tier']),
  tools_selected: entry('context', ['source']),
  tools_expanded: entry('context', ['source']),
  context_assembled: entry('context', ['model']),
  history_retrieved: entry('context', ['source']),
  model_fallback_triggered: entry('context', ['from', 'to', 'reason'], { reason: z.string() }, { reason: 'latency' }),
  model_attempt_cancelled: entry('context', ['model', 'reason']),
  model_attempt_finished: entry('context', ['model', 'result']),
  efficiency_comparison_generated: entry('context', ['datasetVersion']),
  // Evaluation and improvement
  evaluation_started: entry('evaluation', ['datasetVersion', 'environment']),
  evaluation_dataset_created: entry('evaluation', ['datasetVersion']),
  evaluation_case_started: entry('evaluation', ['caseId', 'environment']),
  evaluation_case_finished: entry('evaluation', ['caseId', 'verdict', 'environment']),
  improvement_opportunity_detected: entry('evaluation', ['category', 'confidence']),
  evaluation_comparison_created: entry('evaluation', ['baselineVersion', 'candidateVersion', 'recommendation']),
  candidate_created: entry('evaluation', ['candidateId', 'kind']),
  candidate_evaluated: entry('evaluation', ['candidateId', 'verdict']),
  promotion_approved: entry('evaluation', ['candidateId', 'approvedBy']),
  policy_promoted: entry('evaluation', ['candidateId', 'version']),
  policy_rolled_back: entry('evaluation', ['candidateId', 'toVersion']),
  improvement_report_generated: entry('evaluation', ['scope']),
  evaluation_exported: entry('evaluation', ['scope', 'format']),
  post_promotion_regression_detected: entry('evaluation', ['candidateId', 'metric']),
  // Validation and adoption
  validation_suite_started: entry('validation', ['suite', 'environment', 'sha']),
  validation_suite_finished: entry('validation', ['suite', 'environment', 'sha', 'result']),
  real_evaluation_finished: entry('validation', ['caseId', 'verdict']),
  acceptance_reviewed: entry('validation', ['reviewer', 'verdict']),
  pilot_enabled: entry('validation', ['botId', 'projectId']),
  cross_bot_isolation_verified: entry('validation', ['result']),
  rollout_reviewed: entry('validation', ['verdict']),
  delivery_audited: entry('validation', ['scope', 'actor']),
  milestone_accepted: entry('validation', ['milestone', 'actor']),
} satisfies Record<string, CatalogEntry>;

export type TelemetryEventType = keyof typeof TELEMETRY_CATALOG;
export const TELEMETRY_EVENT_TYPES = Object.keys(TELEMETRY_CATALOG) as TelemetryEventType[];

export function catalogEntry(type: string): CatalogEntry | undefined {
  return (TELEMETRY_CATALOG as Record<string, CatalogEntry>)[type];
}
