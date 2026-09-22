/**
 * Context analysis — token accounting by role and subsystem.
 *
 * Provides visibility into where tokens are being spent.
 * Ported from old_src/utils/contextAnalysis.ts pattern.
 */

import type { LLMMessage } from '../llm/message-types.js';
import { estimateContentTokens } from '../utils/token-counter.js';

export interface ContextAnalysis {
  totalTokens: number;
  messageCount: number;
  byRole: {
    system: number;
    user: number;
    assistant: number;
    tool: number;
  };
  toolResultCount: number;
  toolResultChars: number;
}

/**
 * Analyze context messages and return token breakdown.
 */
export function analyzeContext(messages: readonly LLMMessage[]): ContextAnalysis {
  const byRole = { system: 0, user: 0, assistant: 0, tool: 0 };
  let totalTokens = 0;
  let toolResultCount = 0;
  let toolResultChars = 0;

  for (const msg of messages) {
    const tokens = estimateContentTokens(msg.content);
    totalTokens += tokens;

    const role = msg.role;
    if (role in byRole) {
      byRole[role] += tokens;
    }

    if (msg.role === 'tool') {
      toolResultCount++;
      // Um resultado de tool e sempre texto no papel `tool`; o fallback cobre
      // a forma sem medir base64 de imagem como se fosse prosa.
      toolResultChars +=
        typeof msg.content === 'string'
          ? msg.content.length
          : msg.content.reduce((n, p) => n + (p.text?.length ?? 0), 0);
    }
  }

  return {
    totalTokens,
    messageCount: messages.length,
    byRole,
    toolResultCount,
    toolResultChars,
  };
}
