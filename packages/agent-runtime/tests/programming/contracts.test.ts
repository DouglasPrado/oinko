import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ArtifactSchema,
  OperationReceiptSchema,
  PROGRAMMING_CONTRACT_VERSION,
  ProgrammingError,
  ProgrammingRunSchema,
  PublicationSchema,
  RUN_STATES,
  RUN_TRANSITIONS,
  RunStepSchema,
  assertTransition,
  canTransition,
  completionBlockers,
  isTerminal,
  newRunId,
  validateRunReferences,
} from '../../src/programming/index.js';

const now = Date.UTC(2026, 8, 24);
function run(overrides: Record<string, unknown> = {}) {
  return ProgrammingRunSchema.parse({
    id: newRunId(),
    botId: 'alpha',
    conversationId: 'conv-1',
    projectId: 'loja',
    taskId: 'fix-cart',
    repositoryIds: ['app', 'api'],
    request: { text: 'Corrija o carrinho', mode: 'change' },
    state: 'queued',
    phase: 'queued',
    policySnapshot: { version: 'sha256:abc', policy: {} },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

describe('ProgrammingRun contracts', () => {
  it('round-trips every entity through JSON without losing fields', () => {
    const value = run({ planRevision: 2, currentStepId: 'step-1', revision: 4 });
    expect(ProgrammingRunSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value.contractVersion).toBe(PROGRAMMING_CONTRACT_VERSION);
    const step = RunStepSchema.parse({
      id: 'step-1',
      runId: value.id,
      kind: 'edit',
      status: 'running',
      objective: 'Aplicar correção',
      createdAt: now,
    });
    expect(RunStepSchema.parse(JSON.parse(JSON.stringify(step)))).toEqual(step);
    const receipt = OperationReceiptSchema.parse({
      operationId: 'op-1',
      runId: value.id,
      stepId: step.id,
      kind: 'workspace.applyPatch',
      idempotencyKey: 'key-1',
      paramsHash: 'sha256:1',
      actor: { kind: 'bot', botId: 'alpha' },
      intent: { files: ['src/cart.ts'] },
      state: 'intended',
      createdAt: now,
    });
    expect(OperationReceiptSchema.parse(JSON.parse(JSON.stringify(receipt)))).toEqual(receipt);
    const artifact = ArtifactSchema.parse({
      id: 'art-1',
      runId: value.id,
      type: 'diff',
      repositoryId: 'app',
      treeHash: 'tree:1',
      location: 'ab/abcdef',
      contentHash: 'sha256:ff',
      size: 12,
      capturePolicy: 'full',
      accessScope: { botId: 'alpha', projectId: 'loja' },
      createdAt: now,
    });
    expect(ArtifactSchema.parse(JSON.parse(JSON.stringify(artifact)))).toEqual(artifact);
  });

  it('keeps Task as the unit of work and lets one run reference a PR per repository', () => {
    const value = run();
    expect(value.taskId).toBe('fix-cart');
    expect(value.conversationId).toBe('conv-1');
    const prs = ['app', 'api'].map((repositoryId) =>
      PublicationSchema.parse({
        id: `pub-${repositoryId}`,
        botId: 'alpha',
        projectId: 'loja',
        taskId: 'fix-cart',
        repositoryId,
        branch: 'task/fix-cart',
        originatingRunId: value.id,
        updatedAt: now,
        createdAt: now,
      }),
    );
    expect(new Set(prs.map((pr) => pr.repositoryId))).toEqual(new Set(value.repositoryIds));
    expect(prs.every((pr) => pr.draft)).toBe(true);
  });

  it('validates references against the project instead of trusting the caller', () => {
    const project = {
      id: 'loja',
      allowedBotIds: ['alpha'],
      repositories: [{ id: 'app' }, { id: 'api' }],
    };
    expect(() => validateRunReferences(run(), project)).not.toThrow();
    expect(() => validateRunReferences(run({ repositoryIds: ['ghost'] }), project)).toThrow(
      ProgrammingError,
    );
    expect(() => validateRunReferences(run({ projectId: 'outro' }), project)).toThrow(
      ProgrammingError,
    );
  });
});

describe('run state machine', () => {
  it('allows exactly the transitions in ARCHITECTURE.md', () => {
    const expected: Record<string, string[]> = {
      queued: ['running', 'cancelled', 'blocked'],
      running: ['paused', 'blocked', 'completed', 'failed', 'cancelled'],
      paused: ['queued', 'cancelled', 'blocked'],
      blocked: ['queued', 'cancelled', 'failed'],
      completed: [],
      failed: [],
      cancelled: [],
    };
    expect(RUN_TRANSITIONS).toEqual(expected);
    for (const from of RUN_STATES)
      for (const to of RUN_STATES)
        expect(canTransition(from, to)).toBe(expected[from]!.includes(to));
  });

  it('rejects invalid transitions with a structured error', () => {
    try {
      assertTransition('completed', 'queued');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProgrammingError);
      const structured = (error as ProgrammingError).toJSON();
      expect(structured).toMatchObject({ code: 'invalid_transition', retryable: false });
    }
    expect(() => assertTransition('queued', 'paused')).toThrow(/queued → paused/);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('blocked')).toBe(false);
  });

  it('never completes a run that still has uncertain operations or unmet criteria', () => {
    expect(
      completionBlockers({
        operations: [{ operationId: 'op-1', state: 'uncertain' }],
        criteria: [{ id: 'c1', status: 'satisfied' }],
      }),
    ).toEqual([{ code: 'uncertain_operation', ref: 'op-1' }]);
    expect(
      completionBlockers({
        operations: [{ operationId: 'op-2', state: 'succeeded' }],
        criteria: [
          { id: 'c1', status: 'satisfied' },
          { id: 'c2', status: 'invalidated' },
        ],
      }),
    ).toEqual([{ code: 'criterion_unmet', ref: 'c2' }]);
    expect(completionBlockers({ operations: [], criteria: [] })).toEqual([
      { code: 'no_criteria', ref: 'run' },
    ]);
  });
});

describe('platform boundaries', () => {
  const root = join(import.meta.dirname, '../../../..');
  function files(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
    });
  }

  it('has no condition on a pilot bot name or id in programming domain code', () => {
    for (const file of files(join(root, 'packages/agent-runtime/src/programming'))) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/['"`](dev|Dev|oinko-dev)['"`]/);
    }
  });

  it('keeps the SDK free of Docker, dashboard, Telegram and GitHub App dependencies', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'packages/oinko/package.json'), 'utf8'));
    const deps = Object.keys(manifest.dependencies ?? {});
    expect(deps.filter((dep) => /docker|grammy|telegram|dashboard|octokit|github/i.test(dep))).toEqual(
      [],
    );
    for (const file of files(join(root, 'packages/oinko/src'))) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/from ['"](@oinko\/(bots|environments|dashboard|channel-)|grammy)/);
    }
  });
});
