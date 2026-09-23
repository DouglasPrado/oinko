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

describe('buildRecallInstructions — applying memory', () => {
  const chat = buildRecallInstructions(DIR);
  const coding = buildRecallInstructions(DIR, { codeTools: true });

  it('treats memories as background, not as instructions', () => {
    expect(chat).toMatch(/not instructions/i);
    expect(chat).toMatch(/flatter|always agree/i);
  });

  it('uses a memory only when it changes the answer', () => {
    expect(chat).toMatch(/changes what you conclude, recommend or ask/i);
  });

  it('forbids narrating the retrieval', () => {
    expect(chat).toMatch(/do not narrate/i);
    expect(chat).toContain('"I remember"');
  });

  it('lets the current request win over a stored preference', () => {
    expect(chat).toMatch(/current request wins/i);
  });

  it('keeps open items as context, sensitive details for when the user raises them', () => {
    expect(chat).toMatch(/context, not an agenda/i);
    expect(chat).toMatch(/sensitive/i);
    expect(chat).toMatch(/other people/i);
  });

  it('honours a request to stop using memory', () => {
    expect(chat).toMatch(/not to use memory/i);
  });

  it('keeps code verification out of a bot without code tools', () => {
    expect(chat).not.toContain('grep');
    expect(chat).not.toContain('git log');
  });

  it('adds code verification when the agent can read the code', () => {
    expect(coding).toContain('Before recommending from memory');
    expect(coding).toContain('grep');
  });

  it('never points at tools the agent does not have (plans, tasks)', () => {
    expect(chat).not.toMatch(/plan instead of memory|tasks instead of memory/i);
    expect(coding).not.toMatch(/plan instead of memory|tasks instead of memory/i);
  });
});
