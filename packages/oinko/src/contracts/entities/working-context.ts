/** Offset counts archived messages; the archive itself remains append-only. */
export interface ConversationCheckpoint {
  through: number;
  summary: string;
  updatedAt: number;
}

/** Full output before prompt truncation. References are scoped to one thread. */
export interface ArchivedToolResult {
  id: string;
  name: string;
  content: string;
  isError: boolean;
  createdAt: number;
}

/**
 * Lifecycle of background context work for one conversation. Carries ranges
 * and reasons, never message content.
 */
export interface ContextLifecycleEvent {
  type: 'summary_scheduled' | 'summary_finished' | 'summary_discarded' | 'summary_failed';
  threadId: string;
  through: number;
  end: number;
  traceId?: string;
  reason?: string;
  durationMs?: number;
}
