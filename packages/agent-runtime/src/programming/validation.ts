import type { Actor } from './contracts.js';
import { ProgrammingError } from './errors.js';
import type { TelemetryJournal } from './telemetry/journal.js';
import { readJournal } from './telemetry/journal.js';
import type { ProgrammingDatabase } from './store/database.js';

export type SuiteResult = 'passed' | 'failed' | 'partial';
export interface SuiteOutcome {
  suite: string;
  environment: 'automated' | 'docker' | 'real_provider' | 'human';
  sha: string;
  result: SuiteResult;
  passed: number;
  failed: number;
  /** Skipped scenarios are listed: they block any claim of coverage for them. */
  skipped: string[];
  command: string;
  durationMs?: number;
}

const VALIDATION_TYPES = [
  'validation_suite_started',
  'validation_suite_finished',
  'acceptance_reviewed',
  'pilot_enabled',
  'cross_bot_isolation_verified',
  'rollout_reviewed',
  'delivery_audited',
  'milestone_accepted',
] as const;

/**
 * Durable record of validation: suites run (with SHA, environment and what
 * was skipped) and human decisions (acceptance, pilots, rollout, audit).
 * Only operators record decisions; nothing here marks absence as success.
 */
export class ValidationLog {
  constructor(
    private readonly journal: TelemetryJournal,
    private readonly database: ProgrammingDatabase,
  ) {}

  private operator(actor: Actor): string {
    if (actor.kind !== 'operator') throw new ProgrammingError('permission_denied', 'Somente um operador registra validação e aceite.');
    return actor.id;
  }

  suiteStarted(actor: Actor, input: { suite: string; environment: SuiteOutcome['environment']; sha: string; command: string }): void {
    this.operator(actor);
    this.journal.record('validation_suite_started', {}, input, 'started');
  }

  suiteFinished(actor: Actor, outcome: SuiteOutcome): SuiteOutcome {
    this.operator(actor);
    // A suite with skipped scenarios is at most partial, never a full pass.
    const result: SuiteResult = outcome.failed > 0 ? 'failed' : outcome.skipped.length ? 'partial' : outcome.result;
    const recorded = { ...outcome, result };
    this.journal.record(
      'validation_suite_finished',
      {},
      { ...recorded, skippedCount: outcome.skipped.length, skipped: outcome.skipped.slice(0, 200).join('; ') },
      result === 'passed' ? 'succeeded' : result === 'failed' ? 'failed' : 'info',
    );
    return recorded;
  }

  /** Human review of a story, run or delivery; evidence references are required. */
  acceptance(actor: Actor, input: { scope: string; ref: string; verdict: 'accepted' | 'rejected' | 'pending'; notes: string; evidence: string[] }): void {
    const reviewer = this.operator(actor);
    if (input.verdict === 'accepted' && !input.evidence.length)
      throw new ProgrammingError('invalid_request', 'Aceite exige referências de evidência.');
    this.journal.record('acceptance_reviewed', {}, { reviewer, ...input, evidence: input.evidence.join(', ') }, input.verdict === 'accepted' ? 'succeeded' : 'info');
  }

  pilotEnabled(actor: Actor, input: { botId: string; projectId: string; evidence: string[] }): void {
    this.operator(actor);
    this.journal.record('pilot_enabled', { botId: input.botId, projectId: input.projectId }, { botId: input.botId, projectId: input.projectId, evidence: input.evidence.join(', ') });
  }

  isolationVerified(actor: Actor, input: { result: 'passed' | 'failed'; bots: string[]; checks: string[] }): void {
    this.operator(actor);
    this.journal.record('cross_bot_isolation_verified', {}, { result: input.result, bots: input.bots.join(','), checks: input.checks.join('; ') }, input.result === 'passed' ? 'succeeded' : 'failed');
  }

  rolloutReviewed(actor: Actor, input: { verdict: 'expand' | 'hold' | 'rollback'; scope: string; notes: string }): void {
    this.operator(actor);
    this.journal.record('rollout_reviewed', {}, input);
  }

  deliveryAudited(actor: Actor, input: { scope: string; findings: string[]; evidence: string[] }): void {
    const auditor = this.operator(actor);
    this.journal.record('delivery_audited', {}, { scope: input.scope, actor: auditor, findings: input.findings.join('; '), evidence: input.evidence.join(', ') });
  }

  /** A milestone is accepted only by a person, with its stories' evidence. */
  milestoneAccepted(actor: Actor, input: { milestone: string; evidence: string[]; pending: string[] }): void {
    const by = this.operator(actor);
    if (input.pending.length)
      throw new ProgrammingError('invalid_transition', `Há pendências no milestone: ${input.pending.join('; ')}.`);
    if (!input.evidence.length) throw new ProgrammingError('invalid_request', 'Aceite de milestone exige evidências.');
    this.journal.record('milestone_accepted', {}, { milestone: input.milestone, actor: by, evidence: input.evidence.join(', ') }, 'succeeded');
  }

  history(limit = 200) {
    return VALIDATION_TYPES.flatMap((type) => readJournal(this.database, { type }))
      .map((event) => event.envelope)
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, limit);
  }
}
