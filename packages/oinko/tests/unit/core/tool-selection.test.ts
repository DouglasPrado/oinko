import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { screenTurn } from '../../../src/core/turn-screening.js';
import { createToolSelection } from '../../../src/tools/tool-selection.js';
import { createToolResultReader } from '../../../src/tools/builtin/tool-result.js';
import { ToolExecutor } from '../../../src/tools/tool-executor.js';
import { ConversationManager } from '../../../src/core/conversation-manager.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';
import type { AgentTool } from '../../../src/contracts/entities/agent-tool.js';

const read: AgentTool = {
  name: 'read',
  description: 'Read repository files',
  parameters: z.object({ path: z.string() }),
  execute: async () => 'file',
};
const write: AgentTool = {
  name: 'write',
  description: 'Write repository files',
  parameters: z.object({ path: z.string(), content: z.string() }),
  execute: async () => 'saved',
};

describe('tool selection and discovery', () => {
  it('batches routing and tool questions, uses task state, and selects more than one tool', async () => {
    const decide = vi.fn().mockResolvedValue({
      tier: { value: 'capable', confidence: 1 },
      tool0: { value: true, confidence: 0.99 },
      tool1: { value: true, confidence: 0.97 },
    });
    const result = await screenTurn('continue', { decide } as Decider, {
      routing: { capableModel: 'main', fastModel: 'fast' },
      taskContext: 'repair sum in worktree neblina',
      tools: { catalog: [read, write], maxTools: 10, minConfidence: 0.7 },
    });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0]![0]).toContain('worktree neblina');
    expect(Object.keys(decide.mock.calls[0]![1])).toEqual(['tier', 'tool0', 'tool1']);
    expect(result.toolNames).toEqual(['read', 'write']);
  });

  it('keeps all authorized tools available on decision outage', async () => {
    const result = await screenTurn(
      'repair code',
      { decide: vi.fn().mockRejectedValue(new Error('offline')) } as Decider,
      { tools: { catalog: [read, write], maxTools: 1, minConfidence: 0.7 } },
    );
    expect(result.toolNames).toEqual(['read', 'write']);
    expect(result.toolSelectionFallback).toBe(true);
  });

  it('can select no operational tools for a greeting, without trusting invented tool ids', async () => {
    const result = await screenTurn(
      'hello',
      {
        decide: vi.fn().mockResolvedValue({
          tool0: { value: false, confidence: 1 },
          tool1: { value: false, confidence: 1 },
          tool9: { value: true, confidence: 1 },
        }),
      } as Decider,
      { tools: { catalog: [read, write], maxTools: 10, minConfidence: 0.7 } },
    );
    expect(result.toolNames).toEqual([]);
  });

  it('discovers tools during a turn without changing another turn or the shared registry', async () => {
    const executor = new ToolExecutor();
    executor.register(read);
    executor.register(write);
    const a = createToolSelection(executor, ['read'], 2);
    const b = createToolSelection(executor, [], 2);
    expect(a.definitions().map((t) => t.function.name)).toEqual(['read', 'ToolSearch']);
    const result = await a.executor.execute('ToolSearch', { names: ['write', 'invented'] });
    expect(result.content).toContain('write');
    expect(a.definitions().map((t) => t.function.name)).toEqual(['read', 'write', 'ToolSearch']);
    expect(b.definitions().map((t) => t.function.name)).toEqual(['ToolSearch']);
    expect(executor.listTools()).toHaveLength(2);
    expect(a.definitions().some((t) => t.function.name === 'invented')).toBe(false);
  });

  it('discovers by description and sees tools registered mid-loop', async () => {
    const executor = new ToolExecutor();
    executor.register(read);
    const scope = createToolSelection(executor, [], 3);
    executor.register(write);
    await scope.executor.execute('ToolSearch', { query: 'Write repository files' });
    expect(scope.definitions().some((t) => t.function.name === 'write')).toBe(true);
  });

  it('archives complete output before truncation and scopes exact retrieval', async () => {
    const manager = new ConversationManager();
    const executor = new ToolExecutor({
      archiveResult: (name, result, context) =>
        manager.saveToolResult(context.threadId!, {
          id: context.toolCallId!,
          name,
          content: result.content,
          isError: !!result.isError,
          createdAt: 1,
        }),
    });
    executor.register({
      ...read,
      maxResultChars: 100,
      execute: async () => 'a'.repeat(5000) + 'NEEDLE' + 'z'.repeat(5000),
    });
    await executor.execute('read', { path: 'x' }, { threadId: 'a', toolCallId: 'id' });
    expect(manager.getToolResult('a', 'id')?.content).toHaveLength(10006);
    executor.register(createToolResultReader(manager));
    const own = await executor.execute(
      'ToolResult',
      { reference: 'id', query: 'NEEDLE', maxChars: 100 },
      { threadId: 'a' },
    );
    expect(own.content).toContain('NEEDLE');
    const stranger = await executor.execute('ToolResult', { reference: 'id' }, { threadId: 'b' });
    expect(stranger.isError).toBe(true);
    expect(stranger.content).not.toContain('NEEDLE');
  });

  it('finds a buried marker when the model sends a search phrase instead of an exact substring', async () => {
    const manager = new ConversationManager();
    manager.saveToolResult('a', {
      id: 'report',
      name: 'logs',
      content: `RELATORIO 2\n${'linha regular\n'.repeat(300)}audit-marker=AUDIT-2-X9Q7\n${'linha regular\n'.repeat(300)}`,
      isError: false,
      createdAt: 1,
    });
    const executor = new ToolExecutor();
    executor.register(createToolResultReader(manager));
    const result = await executor.execute(
      'ToolResult',
      { reference: 'report', query: 'relatorio 2 identificador audit', maxChars: 2000 },
      { threadId: 'a' },
    );
    expect(result.content).toContain('AUDIT-2-X9Q7');
    expect(JSON.parse(result.content).found).toBe(true);
  });
});

describe('essential tools under selection', () => {
  const complete: AgentTool = {
    name: 'complete_work',
    description: 'Declare completion',
    parameters: z.object({}),
    alwaysAvailable: true,
    execute: async () => 'ok',
  };

  it('keeps tools marked alwaysAvailable exposed even when none was selected', () => {
    const executor = new ToolExecutor();
    executor.register(read);
    executor.register(write);
    executor.register(complete);
    const selection = createToolSelection(executor, [], 2);
    expect(selection.definitions().map((t) => t.function.name)).toEqual(['complete_work', 'ToolSearch']);
  });

  it('does not ask the decider about essential tools', async () => {
    const decide = vi.fn().mockResolvedValue({ tool0: { value: true, confidence: 1 } });
    const result = await screenTurn('fix', { decide } as Decider, {
      tools: { catalog: [read, complete], maxTools: 5, minConfidence: 0.7 },
    });
    expect(Object.keys(decide.mock.calls[0]![1])).toEqual(['tool0']);
    expect(String(decide.mock.calls[0]![1].tool0.instructions)).toContain('read');
    expect(result.toolNames).toEqual(['read']);
  });
});
