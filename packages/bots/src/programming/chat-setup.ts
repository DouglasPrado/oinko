import type { BotDefinition } from '../schema.js';
import { PROGRAMMING_INSTRUCTIONS } from '../programming-tools.js';

/** Chat tools that only look at a workspace; safe while durable runs do the changing. */
export const READ_ONLY_WORKSPACE_TOOLS = ['workspace_status', 'workspace_read', 'workspace_logs'] as const;

/** Oinko MCP tools that change workspaces: with durable runs they belong to the run, not the chat. */
export const DURABLE_ONLY_MCP_TOOLS = [
  'oinko_create_task',
  'oinko_sandbox',
  'oinko_exec',
  'oinko_write_file',
  'oinko_start_preview',
  'oinko_stop_preview',
] as const;

const READ_ONLY_INSTRUCTIONS =
  '\nNo chat, use workspace_status, workspace_read e workspace_logs só para consultas rápidas. Qualquer alteração de código, criação de tarefa, comando ou prévia vai por programming_start: é o trabalho durável que executa em segundo plano.';

/**
 * How a bot's conversational agent handles programming. With durable runs
 * the chat delegates every change to a run (which survives the turn and
 * reports back); without them it keeps the interactive tools, and must not
 * pretend to keep working after it answers.
 */
export function chatProgramming(bot: Pick<BotDefinition, 'programming' | 'programmingPolicy'>) {
  const durable = !!bot.programmingPolicy?.enabled;
  const legacy = !!bot.programming;
  const legacyTools: 'all' | 'read-only' | 'none' = !legacy ? 'none' : durable ? 'read-only' : 'all';
  const exposed =
    legacyTools === 'all'
      ? ['workspace_status', 'workspace_task', 'workspace_exec', 'workspace_read', 'workspace_write', 'workspace_preview', 'workspace_logs']
      : legacyTools === 'read-only'
        ? [...READ_ONLY_WORKSPACE_TOOLS]
        : [];
  return {
    durable,
    legacyTools,
    /** Tools the bot has internally: the Oinko MCP must not add copies. */
    internalTools: new Set<string>([...exposed, ...(durable ? ['programming_start', 'programming_status', 'programming_steer', 'programming_control'] : [])]),
    /** Oinko MCP tools removed from the chat altogether. */
    mcpExcluded: new Set<string>(durable ? DURABLE_ONLY_MCP_TOOLS : []),
    /** Instructions for the legacy tools; the durable ones come with the chat tools. */
    legacyInstructions: legacyTools === 'all' ? PROGRAMMING_INSTRUCTIONS : legacyTools === 'read-only' ? READ_ONLY_INSTRUCTIONS : '',
  };
}
