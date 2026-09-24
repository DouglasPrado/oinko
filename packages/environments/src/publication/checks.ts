/**
 * Normalization of GitHub check runs and commit statuses for one exact SHA.
 * Absence of checks is never success, and a result is only ever attributed
 * to the SHA it was reported for.
 */
export type CiState = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'unknown';

export interface CiCheck {
  name: string;
  source: 'check_run' | 'status';
  state: CiState;
  /** GitHub's raw conclusion/state, kept for audit. */
  conclusion: string | null;
  /** Neutral/skipped runs pass branch protection but validated nothing. */
  skipped: boolean;
  required: boolean | 'unknown';
  url: string | null;
  app: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

type Json = Record<string, unknown>;
const str = (value: unknown) => (typeof value === 'string' ? value : null);

function checkRunState(status: unknown, conclusion: unknown): CiState {
  if (status !== 'completed') {
    if (status === 'in_progress') return 'running';
    if (['queued', 'waiting', 'requested', 'pending'].includes(String(status))) return 'queued';
    return 'unknown';
  }
  switch (conclusion) {
    case 'success':
    case 'neutral':
    case 'skipped':
      return 'passed';
    case 'failure':
    case 'timed_out':
    case 'action_required':
    case 'startup_failure':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

function statusState(state: unknown): CiState {
  if (state === 'success') return 'passed';
  if (state === 'failure' || state === 'error') return 'failed';
  if (state === 'pending') return 'running';
  return 'unknown';
}

/** Check runs and statuses reported for `sha`; anything for another SHA is dropped. */
export function normalizeChecks(
  sha: string,
  checkRuns: Json[],
  statuses: Json[],
  required: string[] | 'unknown',
) {
  const isRequired = (name: string) =>
    required === 'unknown' ? 'unknown' : required.includes(name);
  const checks: CiCheck[] = [];
  const latest = new Map<string, Json>();
  for (const run of checkRuns) {
    if (run.head_sha !== sha) continue;
    const name = String(run.name ?? 'check');
    const previous = latest.get(name);
    // Re-runs report several runs with the same name; the newest one counts.
    if (!previous || Number(run.id ?? 0) > Number(previous.id ?? 0)) latest.set(name, run);
  }
  for (const [name, run] of latest) {
    const app = run.app as Json | undefined;
    checks.push({
      name,
      source: 'check_run',
      state: checkRunState(run.status, run.conclusion),
      conclusion: str(run.conclusion) ?? str(run.status),
      skipped: run.conclusion === 'skipped' || run.conclusion === 'neutral',
      required: isRequired(name),
      url: str(run.html_url) ?? str(run.details_url),
      app: str(app?.slug),
      startedAt: str(run.started_at),
      completedAt: str(run.completed_at),
    });
  }
  // The combined status lists the latest status per context.
  for (const status of statuses) {
    const name = String(status.context ?? 'status');
    if (latest.has(name)) continue;
    checks.push({
      name,
      source: 'status',
      state: statusState(status.state),
      conclusion: str(status.state),
      skipped: false,
      required: isRequired(name),
      url: str(status.target_url),
      app: null,
      startedAt: str(status.created_at),
      completedAt: status.state === 'pending' ? null : str(status.updated_at),
    });
  }
  checks.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const missingRequired =
    required === 'unknown'
      ? []
      : required.filter((name) => !checks.some((check) => check.name === name));
  return { checks, missingRequired, ...overall(checks, missingRequired) };
}

export function overall(
  checks: CiCheck[],
  missingRequired: string[] = [],
): { state: CiState; reason: string } {
  if (!checks.length) return { state: 'unknown', reason: 'none' };
  const states = new Set(checks.map((check) => check.state));
  if (states.has('failed')) return { state: 'failed', reason: 'failed' };
  if (states.has('cancelled')) return { state: 'cancelled', reason: 'cancelled' };
  if (states.has('running')) return { state: 'running', reason: 'running' };
  if (states.has('queued')) return { state: 'queued', reason: 'queued' };
  // An expected required check that never reported is still pending.
  if (missingRequired.length) return { state: 'queued', reason: 'required_missing' };
  if (states.has('unknown')) return { state: 'unknown', reason: 'unknown_state' };
  if (checks.every((check) => check.skipped)) return { state: 'unknown', reason: 'all_skipped' };
  return { state: 'passed', reason: 'passed' };
}
