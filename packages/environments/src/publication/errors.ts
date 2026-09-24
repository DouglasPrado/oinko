/**
 * Structured publication errors. Every command returns `{ ok: false, error }`
 * instead of throwing, so callers (runtime, MCP, dashboard) keep the code,
 * the retry hint and the operation it belongs to. Messages are pt-BR and are
 * redacted before they leave the runner.
 */
export const PUBLICATION_ERROR_CODES = [
  // Authorization and addressing
  'admin_only',
  'publisher_required',
  'not_found',
  'task_not_ready',
  'repository_not_linked',
  // GitHub App configuration
  'github_app_not_configured',
  'master_key_missing',
  'invalid_private_key',
  // Installation and access
  'installation_not_configured',
  'installation_not_found',
  'installation_suspended',
  'insufficient_permissions',
  'repository_not_accessible',
  'app_auth_failed',
  'clock_skew',
  'github_unauthorized',
  'permission_denied',
  'rate_limited',
  'github_timeout',
  'github_unavailable',
  'github_redirect',
  'github_validation_failed',
  // Review and push
  'revision_changed',
  'branch_mismatch',
  'branch_moved',
  'unborn_branch',
  'checks_stale',
  'secret_detected',
  'remote_conflict',
  'base_not_found',
  'no_changes',
  'review_too_large',
  'integrity_failed',
  'push_rejected',
  'sandbox_failed',
  'git_failed',
  'operation_uncertain',
  'idempotency_conflict',
  // Pull requests and checks
  'branch_not_published',
  'pr_closed',
  'draft_not_supported',
  'commit_not_found',
] as const;
export type PublicationErrorCode = (typeof PUBLICATION_ERROR_CODES)[number];

export interface PublicationErrorOptions {
  retryable?: boolean;
  /** The effect may have happened remotely; reconcile before repeating it. */
  uncertain?: boolean;
  details?: Record<string, unknown>;
  status?: number;
}

export class PublicationError extends Error {
  readonly retryable: boolean;
  readonly uncertain: boolean;
  readonly details?: Record<string, unknown>;
  readonly status?: number;
  constructor(
    readonly code: PublicationErrorCode,
    message: string,
    options: PublicationErrorOptions = {},
  ) {
    super(message);
    this.retryable = options.retryable ?? false;
    this.uncertain = options.uncertain ?? false;
    if (options.details) this.details = options.details;
    if (options.status !== undefined) this.status = options.status;
  }
}

export interface ErrorBody {
  code: PublicationErrorCode;
  message: string;
  retryable: boolean;
  operationId?: string;
  details?: Record<string, unknown>;
}

export function errorBody(error: unknown, operationId?: string): ErrorBody {
  if (error instanceof PublicationError)
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(operationId && { operationId }),
      ...(error.details && { details: error.details }),
    };
  return {
    code: 'git_failed',
    message: error instanceof Error ? error.message : 'Operação de publicação falhou.',
    retryable: true,
    ...(operationId && { operationId }),
  };
}
