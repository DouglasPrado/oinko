import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Agent } from '../../src/agent.js';
import type { Decider, Question } from '../../src/contracts/entities/decider.js';
import { createSSEResponse, textResponseFrames, toolCallFrames } from './helpers.js';

const text = (content: string) => createSSEResponse(textResponseFrames({ content }));
const call = (name: string, args: unknown, id: string) =>
  createSSEResponse(toolCallFrames({ toolCallId: id, name, arguments: JSON.stringify(args) }));
const agents: Agent[] = [];
afterEach(async () => {
  await Promise.all(agents.splice(0).map((a) => a.destroy()));
});

describe('E2E adaptive context', () => {
  it('discovers a missing tool and refreshes the actual model schemas before executing it', async () => {
    const requests: { tools: { function: { name: string } }[] }[] = [];
    const replies = [
      call('ToolSearch', { names: ['hidden_calculator'] }, 'discover'),
      call('hidden_calculator', { a: 20, b: 22 }, 'calculate'),
      text('42'),
    ];
    const execute = vi.fn(async ({ a, b }: { a: number; b: number }) => String(a + b));
    const decider = {
      decide: async (_state: string, questions: Record<string, Question>) =>
        Object.fromEntries(
          Object.keys(questions).map((key) => [key, { value: false, confidence: 1 }]),
        ),
    } as Decider;
    const agent = Agent.create({
      apiKey: 'test',
      model: 'test',
      memory: { enabled: false },
      knowledge: { enabled: false },
      logLevel: 'silent',
      context: { enabled: true },
      decider,
      fetch: async (request) => {
        requests.push(await request.json());
        return replies.shift()!;
      },
    });
    agents.push(agent);
    agent.addTool({
      name: 'hidden_calculator',
      description: 'Sums two numbers',
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute,
    });
    expect(await agent.chat('Calculate 20 + 22')).toBe('42');
    expect(requests[0]!.tools.some((t) => t.function.name === 'hidden_calculator')).toBe(false);
    expect(requests[1]!.tools.some((t) => t.function.name === 'hidden_calculator')).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('keeps full tools when the selector is down and exposes the fallback', async () => {
    const requests: { tools: { function: { name: string } }[] }[] = [];
    const agent = Agent.create({
      apiKey: 'test',
      model: 'test',
      memory: { enabled: false },
      knowledge: { enabled: false },
      logLevel: 'silent',
      context: { enabled: true },
      decider: { decide: vi.fn().mockRejectedValue(new Error('offline')) },
      fetch: async (request) => {
        requests.push(await request.json());
        return text('ok');
      },
    });
    agents.push(agent);
    agent.addTool({
      name: 'read',
      description: 'Read file',
      parameters: z.object({}),
      execute: async () => 'ok',
    });
    const events = [];
    for await (const event of agent.stream('hello')) events.push(event);
    expect(events[0]?.type).toBe('agent_start');
    expect(events.some((e) => e.type === 'warning' && e.code === 'tool_selection_fallback')).toBe(
      true,
    );
    expect(requests[0]!.tools.some((t) => t.function.name === 'read')).toBe(true);
  });
});

describe('E2E context composition on agent_start', () => {
  it('reports the exposed tools, whether they were selected and tokens per component', async () => {
    const decider = {
      decide: async (_state: string, questions: Record<string, Question>) =>
        Object.fromEntries(Object.keys(questions).map((key) => [key, { value: false, confidence: 1 }])),
    } as Decider;
    const agent = Agent.create({
      apiKey: 'test',
      model: 'test',
      memory: { enabled: false },
      knowledge: { enabled: false },
      logLevel: 'silent',
      context: { enabled: true },
      decider,
      fetch: async () => text('ok'),
    });
    agents.push(agent);
    agent.addTool({ name: 'hidden_calculator', description: 'Sums two numbers', parameters: z.object({ a: z.number() }), execute: async () => '1' });
    agent.addTool({ name: 'finish', description: 'Declare completion', parameters: z.object({}), alwaysAvailable: true, execute: async () => 'done' });
    const events = [];
    for await (const event of agent.stream('Olá')) events.push(event);
    const start = events.find((event) => event.type === 'agent_start');
    expect(start?.type === 'agent_start' && start.context).toMatchObject({
      selected: true,
      tools: expect.arrayContaining(['finish', 'ToolSearch']),
      totalTokens: expect.any(Number),
    });
    const context = start?.type === 'agent_start' ? start.context! : undefined;
    expect(context!.tools).not.toContain('hidden_calculator');
    expect(context!.components.find((component) => component.source === 'tools:schema')?.tokens).toBeGreaterThan(0);
    expect(context!.components.find((component) => component.source === 'history:recent')).toBeDefined();
  });
});
