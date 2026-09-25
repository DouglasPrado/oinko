import { describe, expect, it } from 'vitest';
import { describeRunState, type Criterion, type Evidence } from '../../src/programming/index.js';
import { check, createService, edit, operator, ScriptedExecutor } from './service-helpers.js';
import { tempRoot, twoBotMatrix } from './helpers.js';

const criteria = (checks: Criterion['status'], changes: Criterion['status'] = 'satisfied'): Criterion[] => [
  { id: 'changes', kind: 'diff', description: 'Alterações aplicadas na worktree da tarefa', status: changes, evidenceRefs: [] },
  { id: 'checks', kind: 'check', description: 'Verificações aprovadas', status: checks, evidenceRefs: [] },
];

describe('the cycle starts from the recorded state, not from rediscovery', () => {
  it('names the current revision, the files the run changed and the checks of this revision with their errors', () => {
    const evidence: Evidence[] = [
      { kind: 'edit', repositoryId: 'app', paths: ['src/theme.tsx'], revision: 'tree:aaa' },
      { kind: 'edit', repositoryId: 'app', paths: ['src/theme.test.tsx', 'src/theme.tsx'], revision: 'tree:bbb' },
      { kind: 'check', checkKind: 'test', repositoryId: 'app', result: 'passed', revision: 'tree:aaa', fingerprint: 'old' },
      { kind: 'check', checkKind: 'typecheck', repositoryId: 'app', result: 'failed', revision: 'tree:bbb', fingerprint: 't', errors: ["src/workbench.test.tsx(3,24): error TS2307: Cannot find module '../../../../tests/helpers/render'"] },
    ];
    const state = describeRunState({ criteria: criteria('failed'), evidence, revisions: new Map([['app', 'tree:bbb']]) });
    expect(state).toContain('tree:bbb');
    expect(state).toContain('src/theme.test.tsx, src/theme.tsx');
    expect(state).toMatch(/typecheck: failed[\s\S]*TS2307: Cannot find module/);
    // A check of an older revision says nothing about the code now.
    expect(state).not.toMatch(/test: passed/);
    expect(state).toMatch(/test: não rodado nesta revisão/);
  });

  it('says what satisfies each open criterion, so the agent never guesses what the evaluator wants', () => {
    const state = describeRunState({ criteria: criteria('pending', 'pending'), evidence: [], revisions: new Map() });
    expect(state).toMatch(/changes[^\n]*workspace_replace[^\n]*commit não conta/);
    expect(state).toMatch(/checks[^\n]*workspace_check[^\n]*test, typecheck, lint, build/);
    const done = describeRunState({ criteria: criteria('satisfied'), evidence: [], revisions: new Map() });
    expect(done).toMatch(/Todos os critérios estão satisfeitos[^\n]*programming_complete/);
  });

  it('puts the state in the cycle prompt and tells what to do when a completion is refused', async () => {
    const access = twoBotMatrix();
    const executor = new ScriptedExecutor([
      (input) => {
        input.context.record(edit('r1'));
        return { summary: 'editei', traceIds: [], completion: { summary: 'pronto' } };
      },
      (input) => {
        input.context.record(check('r1', 'passed'));
        return { summary: 'testei', traceIds: [], completion: { summary: 'pronto' } };
      },
    ]);
    const harness = createService(tempRoot(), access, { executor });
    const id = harness.service.start(operator, { botId: 'alpha', projectId: 'one', text: 'x' }).run.id;
    await harness.service.idle();
    expect(harness.store.getRun(id)?.state).toBe('completed');
    const second = executor.inputs[1]!;
    expect(second.state).toMatch(/Arquivos alterados pelo run/);
    expect(second.feedback).toMatch(/checks[^\n]*workspace_check/);
    expect(second.feedback).not.toMatch(/Produza a evidência que falta/);
    await harness.close();
  });
});
