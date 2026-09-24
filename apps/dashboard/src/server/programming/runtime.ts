import 'server-only';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { openProgramming, type ProgrammingRuntime } from '@oinko/bots/programming';
import { ProgrammingError } from '@oinko/agent-runtime/programming';

const KEY = Symbol.for('@oinko/dashboard/programming');

/**
 * The installation's programming runtime, opened without an executor: the
 * dashboard persists requests and controls; each bot's worker executes them.
 */
export function programming(): ProgrammingRuntime {
  const holder = globalThis as typeof globalThis & { [KEY]?: ProgrammingRuntime };
  holder[KEY] ??= openProgramming({
    root: process.env.OINKO_ROOT || resolve(process.cwd(), '../..'),
    producer: 'dashboard',
  });
  return holder[KEY];
}

/** The dashboard session is the installation administrator. */
export const OPERATOR = { kind: 'operator', id: 'dashboard' } as const;

const STATUS: Record<string, number> = {
  not_found: 404,
  permission_denied: 403,
  capability_disabled: 409,
  invalid_request: 400,
  invalid_transition: 409,
  revision_conflict: 409,
  idempotency_conflict: 409,
  analysis_only: 409,
  explicit_authorization_required: 403,
  unavailable: 503,
};

export function programmingResponse(error: unknown): Response {
  if (error instanceof ProgrammingError)
    return Response.json({ error: error.message, code: error.code }, { status: STATUS[error.code] ?? 500 });
  if (error instanceof ZodError)
    return Response.json(
      { error: `Confira os campos: ${error.issues.map((issue) => issue.path.join('.')).join(', ')}.`, code: 'invalid_request' },
      { status: 400 },
    );
  return Response.json({ error: 'Não foi possível concluir a operação.', code: 'internal' }, { status: 500 });
}
