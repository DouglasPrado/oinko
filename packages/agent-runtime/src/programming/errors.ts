/**
 * Structured error shared by every interface (dashboard, MCP, channels, tools).
 * `details` must already be redacted: callers never put raw secrets here.
 */
export const PROGRAMMING_ERROR_CODES = [
  'not_found',
  'permission_denied',
  'capability_disabled',
  'invalid_request',
  'invalid_transition',
  'revision_conflict',
  'idempotency_conflict',
  'intent_not_persisted',
  'lease_held',
  'analysis_only',
  'uncertain_operation',
  'explicit_authorization_required',
  'unavailable',
  'internal',
] as const;
export type ProgrammingErrorCode = (typeof PROGRAMMING_ERROR_CODES)[number];

const RETRYABLE: ReadonlySet<ProgrammingErrorCode> = new Set([
  'revision_conflict',
  'lease_held',
  'unavailable',
]);

export interface ProgrammingErrorJSON {
  code: ProgrammingErrorCode;
  message: string;
  retryable: boolean;
  operationId?: string;
  traceId?: string;
  details?: Record<string, unknown>;
}

export class ProgrammingError extends Error {
  readonly code: ProgrammingErrorCode;
  readonly retryable: boolean;
  readonly operationId?: string;
  readonly traceId?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ProgrammingErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      operationId?: string;
      traceId?: string;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = 'ProgrammingError';
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE.has(code);
    if (options.operationId !== undefined) this.operationId = options.operationId;
    if (options.traceId !== undefined) this.traceId = options.traceId;
    if (options.details !== undefined) this.details = options.details;
  }

  toJSON(): ProgrammingErrorJSON {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.operationId !== undefined && { operationId: this.operationId }),
      ...(this.traceId !== undefined && { traceId: this.traceId }),
      ...(this.details !== undefined && { details: this.details }),
    };
  }
}

/** Unknown failures never leak their message: it may carry paths or secrets. */
export function toProgrammingError(error: unknown): ProgrammingError {
  if (error instanceof ProgrammingError) return error;
  return new ProgrammingError('internal', 'Não foi possível concluir a operação de programação.');
}
