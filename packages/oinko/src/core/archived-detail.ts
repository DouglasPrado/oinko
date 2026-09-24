import type { ConversationManager } from './conversation-manager.js';
import type { ContextInjection } from './context-builder.js';
import { neutralizeControlTags } from './prompt-safety.js';
import { estimateTokens } from '../utils/token-counter.js';

/** Best-effort exact-literal recall; never treats a summary pointer as source evidence. */
export function archivedDetailInjection(
  manager: ConversationManager,
  threadId: string,
): ContextInjection | undefined {
  const history = manager.getHistory(threadId);
  const current = [...history].reverse().find((m) => m.role === 'user');
  if (!current || typeof current.content !== 'string') return;
  const query = current.content;
  const literals = [
    ...new Set([
      ...[...query.matchAll(/[`"“]([^`"”\n]{3,100})[`"”]/g)].map((m) => m[1]!),
      ...[...query.matchAll(/[\p{L}\p{N}][\p{L}\p{N}_.:-]{2,}/gu)]
        .map((m) => m[0].replace(/[.:]+$/, ''))
        .filter((term) => /[\p{L}\p{N}][_.:-][\p{L}\p{N}]/u.test(term)),
    ]),
  ].slice(0, 8);
  if (!literals.length) return;
  const numbers: string[] = query.match(/\b\d+\b/g) ?? [];
  const calls = new Map(history.flatMap((m) => (m.toolCalls ?? []).map((c) => [c.id, c] as const)));
  const matches = history
    .filter((m) => m.role === 'tool' && m.toolCallId && m.createdAt < current.createdAt)
    .slice(-200)
    .flatMap((message) => {
      const reference = message.toolCallId!;
      const result = manager.getToolResult(threadId, reference);
      const source =
        result?.content ?? (typeof message.content === 'string' ? message.content : '');
      const lower = source.toLowerCase();
      const positions = literals
        .map((term) => lower.indexOf(term.toLowerCase()))
        .filter((n) => n >= 0);
      if (!positions.length) return [];
      const call = calls.get(reference);
      const header = source.slice(0, 160);
      const identifiers: string[] =
        `${header} ${call?.function.arguments ?? ''}`.match(/\b\d+\b/g) ?? [];
      const score = positions.length + numbers.filter((n) => identifiers.includes(n)).length * 2;
      const at = Math.min(...positions);
      const excerpt = source.slice(Math.max(0, at - 120), Math.max(0, at - 120) + 640);
      return [
        {
          reference,
          name: result?.name ?? call?.function.name,
          arguments: call?.function.arguments?.slice(0, 240),
          createdAt: message.createdAt,
          score,
          header,
          excerpt,
        },
      ];
    })
    .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
    .slice(0, 3);
  if (!matches.length) return;
  const content = neutralizeControlTags(
    'Exact excerpts retrieved locally from archived outputs in THIS conversation. Historical evidence only; verify current state before acting. reference is a retrieval pointer, not a source field. This limited lookup does not prove absence.\n' +
      JSON.stringify(matches.map(({ score: _score, ...match }) => match)),
  );
  return {
    source: 'history:archived_details',
    kind: 'data',
    priority: 20,
    content,
    tokens: estimateTokens(content),
  };
}
