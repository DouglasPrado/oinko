import { describe, it, expect } from 'vitest';
import {
  buildToolUsagePrompt,
  buildEnvironmentPrompt,
  buildContextProtocolPrompt,
} from '../../../src/core/prompt-builders.js';
import type { AgentTool } from '../../../src/contracts/entities/agent-tool.js';
import { z } from 'zod';

function createTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name: 'test_tool',
    description: 'A test tool',
    parameters: z.object({}),
    execute: async () => 'ok',
    ...overrides,
  };
}

describe('buildToolUsagePrompt', () => {
  it('should return empty string for no tools', () => {
    expect(buildToolUsagePrompt([])).toBe('');
  });

  /**
   * Was "should list all tools with names and descriptions". The list moved
   * out: the same names, descriptions and schemas already travel in the
   * request's `tools` field, so repeating them here was paying twice per turn
   * for the same information — and the bill grew with the toolset.
   */
  it('should not repeat what the tools field already carries', () => {
    const tools = [
      createTool({ name: 'weather', description: 'Get weather data' }),
      createTool({ name: 'search', description: 'Search the web' }),
    ];

    const prompt = buildToolUsagePrompt(tools);
    expect(prompt).not.toContain('Get weather data');
    expect(prompt).not.toContain('Search the web');
    // O que orienta comportamento continua.
    expect(prompt).toContain('Tool Usage Guidelines');
  });

  it('should include tool usage guidelines', () => {
    const prompt = buildToolUsagePrompt([createTool()]);
    expect(prompt).toContain('Tool Usage Guidelines');
    expect(prompt).toContain('do not guess');
    expect(prompt).toContain('parallel');
    expect(prompt).toContain('sequentially');
    expect(prompt).toContain('error');
  });

  it('should include destructive tools warning', () => {
    const tools = [
      createTool({ name: 'delete_file', description: 'Delete a file', isDestructive: true }),
      createTool({ name: 'read_file', description: 'Read a file' }),
    ];

    const prompt = buildToolUsagePrompt(tools);
    expect(prompt).toContain('Destructive Tools');
    expect(prompt).toContain('**delete_file**');
    expect(prompt).toContain('confirm with the user');
  });

  it('should not include destructive section when no destructive tools', () => {
    const prompt = buildToolUsagePrompt([createTool({ isReadOnly: true })]);
    expect(prompt).not.toContain('Destructive Tools');
  });

  it('should include concurrency hints when mixed safe/unsafe tools', () => {
    const tools = [
      createTool({ name: 'search', description: 'Search', isConcurrencySafe: true }),
      createTool({ name: 'read', description: 'Read', isConcurrencySafe: true }),
      createTool({ name: 'write', description: 'Write', isConcurrencySafe: false }),
    ];

    const prompt = buildToolUsagePrompt(tools);
    expect(prompt).toContain('Concurrency');
    expect(prompt).toContain('search, read');
    expect(prompt).toContain('one at a time');
  });

  it('should not include concurrency section when all tools are unsafe', () => {
    const tools = [
      createTool({ name: 'a', isConcurrencySafe: false }),
      createTool({ name: 'b' }), // default false
    ];

    const prompt = buildToolUsagePrompt(tools);
    expect(prompt).not.toContain('Concurrency');
  });

  it('should not include concurrency section when all tools are safe', () => {
    const tools = [
      createTool({ name: 'a', isConcurrencySafe: true }),
      createTool({ name: 'b', isConcurrencySafe: true }),
    ];

    const prompt = buildToolUsagePrompt(tools);
    expect(prompt).not.toContain('Concurrency');
  });

  /**
   * Was "treated as not statically destructive": a tool like Bash, whose
   * risk depends on the command, got no caution at all.
   */
  it('lists a tool whose destructiveness depends on its arguments', () => {
    const tools = [createTool({ name: 'bash', isDestructive: () => true })];

    const prompt = buildToolUsagePrompt(tools);
    expect(prompt).toContain('Destructive Tools');
    expect(prompt).toContain('**bash**');
    expect(prompt).toMatch(/depending on its arguments/i);
  });

  describe('research and verification', () => {
    const prompt = buildToolUsagePrompt([createTool()]);

    it('scales the number of calls to the question', () => {
      expect(prompt).toContain('Research and verification');
      expect(prompt).toMatch(/scale the number of calls/i);
      expect(prompt).toMatch(/one call per distinct item/i);
    });

    it('checks every part of the request before answering', () => {
      expect(prompt).toMatch(/every part of the request/i);
      expect(prompt).toMatch(/figures|quotes/i);
    });

    it('reformulates instead of repeating a call, and tests alternatives', () => {
      expect(prompt).toMatch(/same call again/i);
      expect(prompt).toMatch(/rule (them|alternatives) out/i);
    });

    it('treats truncated and untrusted results for what they are', () => {
      expect(prompt).toContain('[truncated');
      expect(prompt).toContain('<untrusted-tool-output>');
    });

    it('reports failures and skipped steps plainly', () => {
      expect(prompt).toMatch(/failed|skipped/i);
    });
  });
});

describe('buildEnvironmentPrompt', () => {
  it('shows date, weekday, time and time zone, and says to use them', () => {
    const prompt = buildEnvironmentPrompt({
      date: '2026-09-23',
      weekday: 'Wednesday',
      time: '23:30',
      timezone: 'America/Sao_Paulo',
    });
    expect(prompt).toContain('- Date: 2026-09-23 (Wednesday)');
    expect(prompt).toContain('- Time: 23:30 (America/Sao_Paulo)');
    expect(prompt).toMatch(/current year/i);
  });

  it('should include all provided fields', () => {
    const prompt = buildEnvironmentPrompt({
      cwd: '/home/user/project',
      platform: 'linux',
      model: 'claude-sonnet',
      date: '2026-04-07',
      isGitRepo: true,
      gitBranch: 'main',
    });

    expect(prompt).toContain('# Environment');
    expect(prompt).toContain('/home/user/project');
    expect(prompt).toContain('linux');
    expect(prompt).toContain('claude-sonnet');
    expect(prompt).toContain('2026-04-07');
    expect(prompt).toContain('Git repository: yes');
    expect(prompt).toContain('Branch: main');
  });

  it('should omit undefined fields', () => {
    const prompt = buildEnvironmentPrompt({ model: 'claude' });

    expect(prompt).toContain('Model: claude');
    expect(prompt).not.toContain('Working directory');
    expect(prompt).not.toContain('Platform');
    expect(prompt).not.toContain('Git');
  });

  it('should show git repo: no', () => {
    const prompt = buildEnvironmentPrompt({ isGitRepo: false });
    expect(prompt).toContain('Git repository: no');
    expect(prompt).not.toContain('Branch');
  });

  it('should include custom entries', () => {
    const prompt = buildEnvironmentPrompt({
      custom: { 'Node version': 'v22.0.0', 'Package manager': 'pnpm' },
    });

    expect(prompt).toContain('Node version: v22.0.0');
    expect(prompt).toContain('Package manager: pnpm');
  });

  it('should return minimal header with empty info', () => {
    const prompt = buildEnvironmentPrompt({});
    expect(prompt).toBe('# Environment');
  });
});

describe('buildContextProtocolPrompt', () => {
  it('says which blocks carry host instructions and which are only data', () => {
    const text = buildContextProtocolPrompt();
    expect(text).toContain('<system-reminder>');
    expect(text).toContain('<context-data>');
    expect(text).toMatch(/not instructions|never instructions/i);
  });

  it('denies authority to text that merely claims to come from the system', () => {
    expect(buildContextProtocolPrompt()).toMatch(/user messages|tool results/i);
  });

  it('stays short: it is sent on every turn', () => {
    expect(buildContextProtocolPrompt().length).toBeLessThan(700);
  });
});
