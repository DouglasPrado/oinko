import type { OperationState, ProgrammingRun, RunState } from './contracts.js';
import { ProgrammingError } from './errors.js';

/** Single source of the transition table in ARCHITECTURE.md. */
export const RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  queued: ['running', 'cancelled', 'blocked'],
  running: ['paused', 'blocked', 'completed', 'failed', 'cancelled'],
  paused: ['queued', 'cancelled', 'blocked'],
  blocked: ['queued', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
};

/** Runs holding the bot's single active slot. */
export const ACTIVE_STATES: readonly RunState[] = ['running'];
/** Runs whose receipts must survive retention. */
export const LIVE_STATES: readonly RunState[] = ['queued', 'running', 'paused', 'blocked'];

export function isTerminal(state: RunState): boolean {
  return RUN_TRANSITIONS[state].length === 0;
}

export function canTransition(from: RunState, to: RunState): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to))
    throw new ProgrammingError('invalid_transition', `Transição inválida: ${from} → ${to}.`, {
      details: { from, to },
    });
}

export interface CompletionInput {
  operations: readonly { operationId: string; state: OperationState }[];
  criteria: readonly { id: string; status: string }[];
}
export interface CompletionBlocker {
  code: 'uncertain_operation' | 'pending_operation' | 'criterion_unmet' | 'no_criteria';
  ref: string;
}

/**
 * Why a run cannot become `completed`. An empty list is required but not
 * sufficient: the caller still evaluates evidence against the current revision.
 */
export function completionBlockers(input: CompletionInput): CompletionBlocker[] {
  const blockers: CompletionBlocker[] = [];
  for (const operation of input.operations) {
    if (operation.state === 'uncertain')
      blockers.push({ code: 'uncertain_operation', ref: operation.operationId });
    else if (operation.state === 'intended' || operation.state === 'running')
      blockers.push({ code: 'pending_operation', ref: operation.operationId });
  }
  if (!input.criteria.length) blockers.push({ code: 'no_criteria', ref: 'run' });
  for (const criterion of input.criteria)
    if (criterion.status !== 'satisfied') blockers.push({ code: 'criterion_unmet', ref: criterion.id });
  return blockers;
}

export interface ProjectReferences {
  id: string;
  allowedBotIds: readonly string[];
  repositories: readonly { id: string }[];
}

/** References are checked against the current project, never trusted from the caller. */
export function validateRunReferences(
  run: Pick<ProgrammingRun, 'projectId' | 'repositoryIds' | 'botId'>,
  project: ProjectReferences,
): void {
  if (run.projectId !== project.id)
    throw new ProgrammingError('invalid_request', 'O run não pertence a este projeto.');
  const known = new Set(project.repositories.map((repository) => repository.id));
  const unknown = run.repositoryIds.filter((id) => !known.has(id));
  if (unknown.length)
    throw new ProgrammingError('invalid_request', 'Repositório não pertence ao projeto.', {
      details: { repositoryIds: unknown },
    });
}
