import { describe, it, expect } from 'vitest';
import {
  buildRecallInstructions,
  buildMemoryInstructions,
} from '../../../src/memory/memory-prompts.js';

const DIR = '/tmp/mem/';

describe('buildRecallInstructions', () => {
  const prompt = buildRecallInstructions(DIR);

  it('tells the agent it has persistent memory', () => {
    expect(prompt).toContain('memory');
    expect(prompt).toContain(DIR);
  });

  /**
   * The main agent never holds the memory tools — only the extraction subagent
   * does. Teaching it to call them costs tokens on every single turn and buys
   * nothing, because it cannot.
   */
  it('does not teach how to write memories', () => {
    expect(prompt).not.toContain('How to save memories');
    expect(prompt).not.toContain('frontmatter');
  });

  it('does not carry the memory type taxonomy', () => {
    expect(prompt).not.toContain('<types>');
    expect(prompt).not.toContain('when_to_save');
  });

  it('keeps what the agent actually needs: trusting recall and persistence', () => {
    expect(prompt.toLowerCase()).toMatch(/verify|check/);
    expect(prompt.toLowerCase()).toMatch(/remember|persist/);
  });

  it('is a fraction of the full instructions', () => {
    const full = buildMemoryInstructions(DIR);
    expect(prompt.length).toBeLessThan(full.length / 3);
  });
});

describe('buildMemoryInstructions', () => {
  it('still carries everything the writing subagent needs', () => {
    const full = buildMemoryInstructions(DIR);
    expect(full).toContain('<types>');
    expect(full).toContain('How to save memories');
    expect(full).toContain('frontmatter');
  });
});
