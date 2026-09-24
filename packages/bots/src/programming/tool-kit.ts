import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { AgentTool, AgentToolResult } from '@oinko/core';
import { KnownFailure, ProgrammingError, requireRunContext, type RunContext } from '@oinko/agent-runtime/programming';
import type { RunnerCommandInput, RunnerCorrelationValue } from '@oinko/environments/client';

/** The runner calls the tools need (EnvironmentClient satisfies it). */
export interface RunnerPort {
  command<T = unknown>(
    command: RunnerCommandInput,
    options?: { correlation?: RunnerCorrelationValue; timeoutMs?: number },
  ): Promise<T>;
}

export type Json = Record<string, unknown>;
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/** Runner errors that mean nothing was written (safe, known failures). */
const CONFLICT_CODES = new Set(['edit_conflict', 'external_change', 'idempotency_conflict', 'invalid_path', 'symlink_escape', 'not_found', 'binary_file', 'unsupported_encoding', 'invalid_range', 'invalid_cursor', 'invalid_regex']);

function ok(value: unknown): AgentToolResult {
  return { content: JSON.stringify(value) };
}
function failure(error: unknown): AgentToolResult {
  const value = error as { code?: string; message?: string; details?: unknown };
  const code = error instanceof ProgrammingError ? error.code : (value.code ?? 'error');
  return {
    content: JSON.stringify({ error: { code, message: value.message ?? 'Falha na operação.', ...(value.details !== undefined && { details: value.details }) } }),
    isError: true,
  };
}

/** Helpers shared by the run tools: location, correlated runner calls and tool wrapping. */
export function toolKit(runner: RunnerPort) {
  function location(context: RunContext, repositoryId?: string) {
    const taskId = context.run.taskId;
    if (!taskId) throw new KnownFailure('no_task', 'Prepare a tarefa do run com workspace_prepare_task antes de usar a worktree.');
    const repository = repositoryId ?? context.run.repositoryIds[0];
    if (!repository || !context.run.repositoryIds.includes(repository))
      throw new KnownFailure('invalid_repository', 'Repositório não pertence a este run.');
    return { taskId, repositoryId: repository };
  }
  const correlation = (context: RunContext, operationId?: string, attemptId?: string): RunnerCorrelationValue => ({
    runId: context.run.id,
    stepId: context.stepId,
    ...(operationId && { operationId }),
    ...(attemptId && { attemptId }),
  });
  const send = <T = Json>(context: RunContext, command: RunnerCommandInput, operationId?: string, attemptId?: string, timeoutMs?: number) =>
    runner.command<T>(command, { correlation: correlation(context, operationId, attemptId), ...(timeoutMs && { timeoutMs }) });
  /** Runner conflicts are known failures: nothing was written. */
  const classify = (error: unknown): never => {
    const code = (error as { code?: string }).code;
    if (code && CONFLICT_CODES.has(code))
      throw new KnownFailure(code, (error as Error).message, (error as { details?: Record<string, unknown> }).details);
    throw error;
  };

  function tool<S extends z.ZodType>(
    name: string,
    description: string,
    parameters: S,
    run: (args: z.output<S>, context: RunContext) => Promise<unknown>,
    flags: { readOnly?: boolean; timeoutMs?: number } = {},
  ): AgentTool {
    return {
      name,
      description,
      parameters,
      isReadOnly: flags.readOnly ?? false,
      isConcurrencySafe: flags.readOnly ?? false,
      untrustedOutput: true,
      timeoutMs: flags.timeoutMs ?? 120_000,
      maxResultChars: 30_000,
      execute: async (args) => {
        try {
          return ok(await run(parameters.parse(args), requireRunContext()));
        } catch (error) {
          return failure(error);
        }
      },
    };
  }

  return { location, correlation, send, classify, tool };
}
