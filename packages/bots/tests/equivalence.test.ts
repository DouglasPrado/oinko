import { expect, it } from 'vitest';
import { isOinkoMcp, scopeOinkoMcp } from '../src/programming/equivalence.js';

it('detects the Oinko MCP and scopes it to the bot without duplicating internal tools', () => {
  expect(isOinkoMcp('/usr/bin/node', ['/repo/packages/mcps/oinko/dist/cli.js', '--root', '/data'])).toBe(true);
  expect(isOinkoMcp('oinko-mcp', [])).toBe(true);
  expect(isOinkoMcp('/usr/bin/node', ['/repo/other-mcp/cli.js'])).toBe(false);
  const scoped = scopeOinkoMcp('alpha', ['/repo/packages/mcps/oinko/dist/cli.js'], new Set(['workspace_read', 'workspace_exec', 'programming_start']));
  expect(scoped.args).toEqual(['/repo/packages/mcps/oinko/dist/cli.js', '--bot', 'alpha']);
  expect(scoped.tools).not.toContain('oinko_read_file');
  expect(scoped.tools).not.toContain('oinko_exec');
  expect(scoped.tools).not.toContain('oinko_run_start');
  expect(scoped.tools).toContain('oinko_run_explain');
  expect(scopeOinkoMcp('alpha', ['cli.js', '--bot', 'alpha'], new Set()).args).toEqual(['cli.js', '--bot', 'alpha']);
});
