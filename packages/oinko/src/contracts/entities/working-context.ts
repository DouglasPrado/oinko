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
