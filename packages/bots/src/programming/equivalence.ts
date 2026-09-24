/** Every tool the Oinko MCP server registers (checked against the server in its tests). */
export const OINKO_MCP_TOOLS = [
  'oinko_bots',
  'oinko_update_bot',
  'oinko_status',
  'oinko_prepare_project',
  'oinko_configure_project',
  'oinko_configure_environment',
  'oinko_configure_network',
  'oinko_create_task',
  'oinko_sandbox',
  'oinko_inspect_repository',
  'oinko_start_preview',
  'oinko_stop_preview',
  'oinko_job',
  'oinko_logs',
  'oinko_exec',
  'oinko_read_file',
  'oinko_write_file',
  'oinko_runs',
  'oinko_run',
  'oinko_run_start',
  'oinko_run_control',
  'oinko_run_explain',
  'oinko_artifact',
] as const;

/** Internal tool each Oinko MCP tool duplicates. */
export const OINKO_TOOL_EQUIVALENTS: Readonly<Record<string, string>> = {
  oinko_status: 'workspace_status',
  oinko_create_task: 'workspace_task',
  oinko_exec: 'workspace_exec',
  oinko_read_file: 'workspace_read',
  oinko_write_file: 'workspace_write',
  oinko_start_preview: 'workspace_preview',
  oinko_stop_preview: 'workspace_preview',
  oinko_logs: 'workspace_logs',
  oinko_runs: 'programming_status',
  oinko_run: 'programming_status',
  oinko_run_start: 'programming_start',
  oinko_run_control: 'programming_control',
};

/** Detects a stdio connection to this repository's Oinko MCP server. */
export function isOinkoMcp(command: string, args: readonly string[]): boolean {
  return [command, ...args].some((part) => /(^|[/\\])(mcps[/\\]oinko[/\\]dist[/\\]cli\.js|oinko-mcp)$/.test(part));
}

/**
 * Adapts a bot's Oinko MCP connection: it acts as that bot (never as the
 * installation administrator) and does not load copies of tools the bot
 * already has internally, so the model sees one tool per capability.
 */
export function scopeOinkoMcp(botId: string, args: readonly string[], internalTools: ReadonlySet<string>, excluded: ReadonlySet<string> = new Set()) {
  const scoped = args.includes('--bot') ? [...args] : [...args, '--bot', botId];
  const tools = OINKO_MCP_TOOLS.filter((name) => {
    if (excluded.has(name)) return false;
    const equivalent = OINKO_TOOL_EQUIVALENTS[name];
    return !equivalent || !internalTools.has(equivalent);
  });
  return { args: scoped, tools };
}
