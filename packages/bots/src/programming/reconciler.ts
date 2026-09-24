import { setTimeout as delay } from 'node:timers/promises';
import type {
  OperationReceipt,
  ProgrammingRun,
  ReconcileResult,
  Reconciler,
} from '@oinko/agent-runtime/programming';
import type { RunnerPort } from './run-tools.js';

/** Check kinds whose repetition cannot change sources: safe to run again when lost. */
const REPEATABLE_CHECKS = new Set(['test', 'lint', 'typecheck', 'build', 'format']);

/**
 * Finds out what happened to an operation interrupted by a crash, from the
 * runner's own records: the edit journal (written before any file), job
 * state and task state. Absence of a trace is proof only where the runner
 * guarantees ordering; everything else stays `unknown` and blocks the run.
 */
export class RunnerReconciler implements Reconciler {
  constructor(
    private readonly runner: RunnerPort,
    private readonly options: { waitMs?: number; pollMs?: number } = {},
  ) {}

  async reconcile(run: ProgrammingRun, receipt: OperationReceipt): Promise<ReconcileResult> {
    const correlation = { runId: run.id, operationId: receipt.operationId };
    switch (receipt.kind) {
      case 'workspace.replace':
      case 'workspace.applyPatch': {
        const repositoryId = String(receipt.intent.repositoryId ?? run.repositoryIds[0] ?? '');
        if (!run.taskId || !repositoryId) return { resolution: 'unknown', evidence: { reason: 'no_location' } };
        const state = await this.runner.command<{ found: boolean; state: string; applied?: string[]; pending?: string[]; conflicted?: string[]; result?: Record<string, unknown> }>(
          { action: 'reconcileEdit', taskId: run.taskId, repositoryId, operationId: receipt.operationId },
          { correlation },
        );
        // The runner journals intent before touching any file: no journal, no write.
        if (!state.found) return { resolution: 'not_applied', evidence: { journal: 'absent' } };
        if (state.state === 'applied') {
          const applied = (state.applied ?? state.result?.applied ?? []) as string[];
          const revision = state.result?.revision;
          return {
            resolution: 'applied',
            evidence: { applied },
            // The edit happened: keep it as evidence even though its tool never answered.
            ...(typeof revision === 'string' && {
              observed: [{ kind: 'edit' as const, repositoryId, paths: applied, revision, operationId: receipt.operationId }],
            }),
          };
        }
        return {
          resolution: 'unknown',
          evidence: { state: state.state, applied: state.applied ?? [], pending: state.pending ?? [], conflicted: state.conflicted ?? [] },
        };
      }
      case 'workspace.check': {
        if (!receipt.jobId) return { resolution: 'not_applied', evidence: { job: 'never_started' } };
        const deadline = Date.now() + (this.options.waitMs ?? 30_000);
        for (;;) {
          const view = await this.runner
            .command<{ job: { state: string; interrupted?: boolean; result?: Record<string, unknown> } }>({ action: 'inspectJob', jobId: receipt.jobId }, { correlation })
            .catch(() => undefined);
          if (!view) return { resolution: 'unknown', evidence: { job: 'not_found' } };
          if (view.job.state === 'succeeded') {
            const result = view.job.result ?? {};
            const revision = typeof result.revisionBefore === 'string' ? result.revisionBefore : undefined;
            const outcome = String(result.result ?? 'infrastructure') as 'passed' | 'failed' | 'skipped' | 'timeout' | 'infrastructure';
            const repositoryId = String(receipt.intent.repositoryId ?? run.repositoryIds[0] ?? '');
            return {
              resolution: 'applied',
              evidence: { job: receipt.jobId, result: outcome },
              ...(revision && {
                observed: [
                  {
                    kind: 'check' as const,
                    checkKind: String(receipt.intent.kind ?? 'test'),
                    repositoryId,
                    result: outcome,
                    revision,
                    ...(typeof result.revisionAfter === 'string' && { revisionAfter: result.revisionAfter }),
                    fingerprint: `${String(receipt.intent.kind)}:${receipt.jobId}:${revision}:${outcome}`,
                  },
                ],
              }),
            };
          }
          if (view.job.state === 'failed') {
            const kind = String(receipt.intent.kind ?? '');
            return view.job.interrupted && !REPEATABLE_CHECKS.has(kind)
              ? { resolution: 'unknown', evidence: { job: receipt.jobId, interrupted: true, kind } }
              : { resolution: 'not_applied', evidence: { job: receipt.jobId, interrupted: !!view.job.interrupted, repeatable: true } };
          }
          if (Date.now() > deadline) return { resolution: 'unknown', evidence: { job: receipt.jobId, state: view.job.state } };
          await delay(this.options.pollMs ?? 1000);
        }
      }
      case 'workspace.createTask': {
        const taskId = String(receipt.intent.taskId ?? '');
        const state = await this.runner.command<{ tasks: { id: string; state: string }[] }>({ action: 'state' }, { correlation });
        const task = state.tasks.find((item) => item.id === taskId);
        if (!task) return { resolution: 'not_applied', evidence: { task: 'absent' } };
        if (task.state === 'ready') return { resolution: 'applied', evidence: { task: taskId } };
        if (task.state === 'failed') return { resolution: 'not_applied', evidence: { task: taskId, state: 'failed' } };
        return { resolution: 'unknown', evidence: { task: taskId, state: task.state } };
      }
      case 'workspace.startPreview': {
        if (!receipt.jobId) return { resolution: 'not_applied', evidence: { job: 'never_started' } };
        const deadline = Date.now() + (this.options.waitMs ?? 30_000);
        for (;;) {
          const state = await this.runner.command<{ jobs: { id: string; state: string }[] }>({ action: 'state' }, { correlation });
          const job = state.jobs.find((item) => item.id === receipt.jobId);
          if (!job) return { resolution: 'unknown', evidence: { job: 'not_found' } };
          if (job.state === 'succeeded') return { resolution: 'applied', evidence: { job: job.id } };
          if (job.state === 'failed') return { resolution: 'not_applied', evidence: { job: job.id, state: 'failed' } };
          if (Date.now() > deadline) return { resolution: 'unknown', evidence: { job: job.id, state: job.state } };
          await delay(this.options.pollMs ?? 1000);
        }
      }
      case 'publication.publish': {
        const repositoryId = String(receipt.intent.repositoryId ?? '');
        if (!run.taskId || !repositoryId) return { resolution: 'unknown', evidence: { reason: 'no_location' } };
        // The runner consults the remote branch and PRs before answering.
        const view = await this.runner.command<{
          ok: boolean;
          error?: { code: string };
          remote?: { sha: string | null };
          pullRequest?: { number: number; url: string } | null;
          receipts?: { operationId: string; state: string; phase: string }[];
        }>({ action: 'reconcilePublication', taskId: run.taskId, repositoryId }, { correlation });
        if (!view.ok) return { resolution: 'unknown', evidence: { code: view.error?.code ?? 'unavailable' } };
        const remote = view.receipts?.find((item) => item.operationId === receipt.operationId);
        // The runner records its receipt before any Git or GitHub effect.
        if (!remote) return { resolution: 'not_applied', evidence: { runnerReceipt: 'absent' } };
        if (remote.state === 'failed') return { resolution: 'not_applied', evidence: { runnerReceipt: 'failed', phase: remote.phase } };
        if (remote.state !== 'succeeded' || !view.remote?.sha)
          return { resolution: 'unknown', evidence: { runnerReceipt: remote.state, phase: remote.phase } };
        const revision = typeof receipt.intent.revision === 'string' ? receipt.intent.revision : undefined;
        return {
          resolution: 'applied',
          evidence: { sha: view.remote.sha, pullRequest: view.pullRequest?.number ?? null },
          observed: [
            {
              kind: 'publication' as const,
              repositoryId,
              sha: view.remote.sha,
              ...(revision && { revision }),
              ...(view.pullRequest && { prNumber: view.pullRequest.number, prUrl: view.pullRequest.url }),
              ci: 'unknown',
              validated: false,
              fingerprint: `${repositoryId}:${view.remote.sha}:${view.pullRequest?.number ?? 'none'}`,
            },
          ],
        };
      }
      default:
        // Shell commands and unknown kinds: their effects cannot be proven.
        return { resolution: 'unknown', evidence: { kind: receipt.kind } };
    }
  }
}
