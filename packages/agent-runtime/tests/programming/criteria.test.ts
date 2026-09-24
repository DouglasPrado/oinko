import { describe, expect, it } from 'vitest';
import { defaultCriteria, evaluateCriteria, type CycleOutcome, type Evidence } from '../../src/programming/index.js';
import { tempRoot, twoBotMatrix } from './helpers.js';
import { ScriptedExecutor, check, createService, edit, operator } from './service-helpers.js';

const functional = (revisions: Record<string, string>, result: 'passed' | 'failed', criterionId = 'checkout'): Evidence => ({
  kind: 'functional',
  criterionId,
  description: 'Checkout mostra o erro do formulário',
  result,
  revision: Object.values(revisions)[0]!,
  revisions,
  previewId: 'p-1',
  url: 'http://app.preview',
  viewport: '1280x800',
  fingerprint: `${criterionId}:${JSON.stringify(revisions)}:${result}`,
});
const criterion = { id: 'checkout', kind: 'functional' as const, description: 'fluxo', status: 'pending' as const, evidenceRefs: [] };

describe('M05-S04 functional evidence is bound to the preview revision', () => {
  it('approves only the exact revisions the preview was built from', () => {
    const evidence = [functional({ app: 'r1', api: 'a1', 'env:web': 'cfg-1' }, 'passed')];
    const same = evaluateCriteria([criterion], evidence, new Map([['app', 'r1'], ['api', 'a1']]));
    expect(same.criteria[0]).toMatchObject({ status: 'satisfied', revision: 'r1' });
    // A rebuild on another revision of any repository does not reuse the old result.
    const moved = evaluateCriteria(same.criteria, evidence, new Map([['app', 'r1'], ['api', 'a2']]));
    expect(moved.criteria[0]!.status).toBe('invalidated');
    expect(moved.invalidated).toEqual([expect.objectContaining({ id: 'checkout' })]);
  });

  it('never confuses a healthy preview with an approved flow: the latest current result wins', () => {
    const evidence = [functional({ app: 'r1' }, 'passed'), functional({ app: 'r1' }, 'failed')];
    expect(evaluateCriteria([criterion], evidence, new Map([['app', 'r1']])).criteria[0]!.status).toBe('failed');
    expect(evaluateCriteria([criterion], [], new Map([['app', 'r1']])).criteria[0]!.status).toBe('pending');
  });
});

describe('M06 publication criterion follows the current revision of every edited repository', () => {
  const draft = defaultCriteria('change', true).filter((item) => item.kind === 'publication');
  const published = (repositoryId: string, revision: string, prNumber = 7): Evidence => ({
    kind: 'publication',
    repositoryId,
    sha: `sha-${revision}`,
    revision,
    prNumber,
    fingerprint: `${repositoryId}:${revision}:${prNumber}`,
  });

  it('is satisfied by a draft of the current revision and invalidated by a later edit', () => {
    const evidence: Evidence[] = [edit('r1'), published('app', 'r1')];
    const first = evaluateCriteria(draft, evidence, new Map([['app', 'r1']]));
    expect(first.criteria[0]!.status).toBe('satisfied');
    const later = evaluateCriteria(first.criteria, [...evidence, edit('r2')], new Map([['app', 'r2']]));
    expect(later.criteria[0]!.status).toBe('invalidated');
  });

  it('requires a draft for each repository the run changed', () => {
    const evidence: Evidence[] = [edit('r1'), edit('a1', 'api'), published('app', 'r1')];
    const revisions = new Map([['app', 'r1'], ['api', 'a1']]);
    expect(evaluateCriteria(draft, evidence, revisions).criteria[0]!.status).toBe('pending');
    expect(evaluateCriteria(draft, [...evidence, published('api', 'a1', 8)], revisions).criteria[0]!.status).toBe('satisfied');
  });
});

describe('service adoption of functional checks and publication records', () => {
  it('turns a functional check into a criterion so a failed flow blocks completion until it passes', async () => {
    const access = twoBotMatrix();
    const done = (summary: string): CycleOutcome => ({ summary, traceIds: [], completion: { summary } });
    const executor = new ScriptedExecutor([
      (input) => {
        input.context.record(edit('r1'));
        input.context.record(check('r1', 'passed'));
        input.context.record(functional({ app: 'r1' }, 'failed'));
        return done('Pronto (mas o fluxo falhou)');
      },
      (input) => {
        input.context.record(edit('r2'));
        input.context.record(check('r2', 'passed'));
        input.context.record(functional({ app: 'r2' }, 'passed'));
        return done('Corrigido');
      },
    ]);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'corrigir checkout' }).run.id;
    await harness.service.idle();
    const run = harness.store.getRun(id)!;
    expect(run.state).toBe('completed');
    expect(run.cycleCount).toBe(2);
    expect(harness.store.criteria(id).find((item) => item.id === 'checkout')).toMatchObject({ kind: 'functional', status: 'satisfied', revision: 'r2' });
    await harness.close();
  });

  it('keeps one draft publication per task repository across runs', () => {
    const access = twoBotMatrix();
    const harness = createService(tempRoot(), access);
    const first = harness.service.start(operator, { botId: 'alpha', projectId: 'two', taskId: 'fix', text: 'a' }).run.id;
    const second = harness.service.start(operator, { botId: 'alpha', projectId: 'two', taskId: 'fix', text: 'b' }).run.id;
    const created = harness.service.recordPublication(first, { repositoryId: 'app', branch: 'oinko/fix', remoteSha: 'a'.repeat(40), prNumber: 5, prUrl: 'https://github.com/acme/app/pull/5', prState: 'open', reconciliationState: 'synced' });
    const updated = harness.service.recordPublication(second, { repositoryId: 'app', branch: 'oinko/fix', remoteSha: 'b'.repeat(40) });
    expect(updated).toMatchObject({ id: created.id, originatingRunId: first, contributingRunIds: [second], prNumber: 5, draft: true, remoteSha: 'b'.repeat(40) });
    expect(() => harness.service.recordPublication(harness.service.start(operator, { botId: 'alpha', projectId: 'two', text: 'sem tarefa' }).run.id, { repositoryId: 'app', branch: 'x' })).toThrow(/sem tarefa/);
    void harness.close();
  });
});
