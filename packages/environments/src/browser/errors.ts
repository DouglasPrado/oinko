import { WorkspaceError } from '@oinko/workspaces';

/**
 * Stable browser error codes. Commands resolve with `{ error: { code,
 * message, retryable, ...details } }` instead of throwing, so the code
 * survives the runner socket (which only forwards a thrown message).
 */
export const BROWSER_ERROR_CODES = {
  forbidden:
    'Operation not allowed for this caller (admin-only, bot-only or project not authorized).',
  run_required: 'No runId in the command or in the request correlation.',
  run_mismatch: 'Command runId differs from the correlation runId.',
  session_not_found: 'Unknown session, or owned by another bot/run (same answer on purpose).',
  session_closed: 'Session was closed, expired or revoked; create a new one.',
  session_failed: 'Session ended by a browser crash or runner restart; create a new one.',
  session_limit: 'Too many active sessions for this bot or runner.',
  browser_disabled: 'Browser is not enabled in the project programming settings.',
  access_revoked: 'Bot lost access to the project; the session was closed.',
  browser_unavailable:
    'Managed browser could not start or crashed; functional checks must be blocked.',
  invalid_url: 'Only absolute http(s) URLs are navigable.',
  navigation_denied: 'Network policy denied the destination (see decision).',
  navigation_failed: 'Navigation failed (DNS, connection, TLS or timeout).',
  snapshot_required: 'Take a snapshot before acting on refs.',
  invalid_ref: 'Ref does not exist in the current snapshot.',
  stale_element: 'Page or element changed since the snapshot; take a new snapshot.',
  action_timeout: 'Action exceeded its timeout (see `uncertain`).',
  action_failed: 'Element was not actionable or the action failed.',
  credential_not_allowed: 'Credentials are only usable in test sessions of their project.',
  credential_not_found: 'Credential is not stored or not enabled for the project.',
  artifact_too_large: 'Captured content exceeds the artifact limit even after compression.',
} as const;
export type BrowserErrorCode = keyof typeof BROWSER_ERROR_CODES;

const RETRYABLE = new Set<BrowserErrorCode>([
  'browser_unavailable',
  'navigation_failed',
  'action_timeout',
  'session_limit',
]);

export class BrowserError extends WorkspaceError {
  constructor(
    readonly code: BrowserErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly retryable = RETRYABLE.has(code),
  ) {
    super(message);
  }
}

export interface BrowserFailure {
  error: { code: string; message: string; retryable: boolean } & Record<string, unknown>;
}

/** Structured result for any error; unknown errors become `action_failed`. */
export function toFailure(error: unknown, redact: (text: string) => string): BrowserFailure {
  if (error instanceof BrowserError)
    return {
      error: {
        ...error.details,
        code: error.code,
        message: redact(error.message),
        retryable: error.retryable,
      },
    };
  const message = error instanceof Error ? error.message : 'Falha no navegador.';
  return {
    error: { code: 'action_failed', message: redact(message).slice(0, 1000), retryable: false },
  };
}
