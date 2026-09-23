import { describe, it, expect } from 'vitest';
import { buildToolUsagePrompt } from '../../../src/core/prompt-builders.js';
import type { AgentTool } from '../../../src/contracts/entities/agent-tool.js';

function tool(name: string, over: Partial<AgentTool> = {}): AgentTool {
  return {
    name,
    description: `Descricao longa e detalhada da ferramenta ${name}, com varias palavras`,
    ...over,
  } as AgentTool;
}

describe('buildToolUsagePrompt', () => {
  it('is empty when there are no tools', () => {
    expect(buildToolUsagePrompt([])).toBe('');
  });

  /**
   * Name and description of every tool already travel in the request's `tools`
   * field, with the full schema. Repeating them in the system prompt costs
   * tokens on every turn and grows with the toolset — 25 tools was ~840 tokens
   * of pure duplication.
   */
  it('does not repeat what the tools field already carries', () => {
    const prompt = buildToolUsagePrompt([tool('run_query'), tool('web_search')]);

    expect(prompt).not.toContain('Descricao longa e detalhada');
    expect(prompt).not.toContain('- **run_query**:');
  });

  it('keeps the behavioural guidance, which the protocol does not convey', () => {
    const prompt = buildToolUsagePrompt([tool('x')]);

    expect(prompt).toContain('parallel');
    expect(prompt).toMatch(/do not guess|make up/i);
    expect(prompt).toMatch(/error/i);
  });

  /** Which tools are destructive is not part of the protocol. */
  it('still names destructive tools', () => {
    const prompt = buildToolUsagePrompt([
      tool('safe'),
      tool('drop_table', { isDestructive: true }),
    ]);

    expect(prompt).toContain('drop_table');
    expect(prompt).toMatch(/irreversible|destructive/i);
  });

  /** Neither is which ones are safe to run at the same time. */
  it('still names the tools that can run in parallel', () => {
    const prompt = buildToolUsagePrompt([
      tool('read_a', { isConcurrencySafe: true }),
      tool('write_b'),
    ]);

    expect(prompt).toContain('read_a');
    expect(prompt).toMatch(/parallel/i);
  });

  it('stays flat as the toolset grows', () => {
    const dez = Array.from({ length: 10 }, (_, i) => tool(`t${i}`));
    const cem = Array.from({ length: 100 }, (_, i) => tool(`t${i}`));

    expect(buildToolUsagePrompt(cem).length).toBe(buildToolUsagePrompt(dez).length);
  });
});
