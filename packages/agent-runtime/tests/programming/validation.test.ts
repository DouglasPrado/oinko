import { describe, expect, it } from 'vitest';
import { ValidationLog, readJournal } from '../../src/programming/index.js';
import { openStore, tempRoot } from './helpers.js';

const operator = { kind: 'operator' as const, id: 'ops' };

describe('M09 validation log', () => {
  it('never records a suite with skipped scenarios or failures as a pass', () => {
    const { database, journal } = openStore(tempRoot());
    const log = new ValidationLog(journal, database);
    log.suiteStarted(operator, { suite: 'docker', environment: 'docker', sha: 'abc', command: 'pnpm test:docker' });
    expect(log.suiteFinished(operator, { suite: 'docker', environment: 'docker', sha: 'abc', result: 'passed', passed: 10, failed: 0, skipped: ['railpack'], command: 'x' }).result).toBe('partial');
    expect(log.suiteFinished(operator, { suite: 'unit', environment: 'automated', sha: 'abc', result: 'passed', passed: 10, failed: 1, skipped: [], command: 'x' }).result).toBe('failed');
    expect(log.suiteFinished(operator, { suite: 'unit', environment: 'automated', sha: 'abc', result: 'passed', passed: 10, failed: 0, skipped: [], command: 'x' }).result).toBe('passed');
    const finished = readJournal(database, { type: 'validation_suite_finished' }).map((event) => event.envelope.payload);
    expect(finished[0]).toMatchObject({ suite: 'docker', result: 'partial', skippedCount: 1, skipped: 'railpack', sha: 'abc' });
    expect(readJournal(database, { type: 'validation_suite_started' })).toHaveLength(1);
  });

  it('keeps human decisions to operators with evidence, and refuses a milestone with pending items', () => {
    const { database, journal } = openStore(tempRoot());
    const log = new ValidationLog(journal, database);
    expect(() => log.acceptance({ kind: 'bot', botId: 'alpha' }, { scope: 'story', ref: 'M05-S04', verdict: 'accepted', notes: '', evidence: ['x'] })).toThrow(/operador/);
    expect(() => log.acceptance(operator, { scope: 'story', ref: 'M05-S04', verdict: 'accepted', notes: '', evidence: [] })).toThrow(/evidência/);
    log.acceptance(operator, { scope: 'story', ref: 'M05-S04', verdict: 'pending', notes: 'falta Telegram real', evidence: [] });
    expect(() => log.milestoneAccepted(operator, { milestone: 'M05', evidence: ['report'], pending: ['Telegram real'] })).toThrow(/pendências/);
    log.milestoneAccepted(operator, { milestone: 'M00', evidence: ['validation-report.md'], pending: [] });
    log.pilotEnabled(operator, { botId: 'alpha', projectId: 'one', evidence: ['run-1'] });
    log.isolationVerified(operator, { result: 'passed', bots: ['alpha', 'beta'], checks: ['queues', 'telemetry'] });
    log.rolloutReviewed(operator, { verdict: 'hold', scope: 'alpha/one', notes: 'aguardar CI real' });
    log.deliveryAudited(operator, { scope: 'M09', findings: ['sem aceite humano'], evidence: ['report'] });
    expect(log.history().map((event) => event.type).sort()).toEqual(
      ['acceptance_reviewed', 'cross_bot_isolation_verified', 'delivery_audited', 'milestone_accepted', 'pilot_enabled', 'rollout_reviewed'].sort(),
    );
  });
});
