import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_BEHAVIOR_PROMPT } from '../../../src/core/behavior-prompt.js';
import { Agent } from '../../../src/agent.js';

describe('DEFAULT_BEHAVIOR_PROMPT', () => {
  it('matches effort to the ask and asks at most one question', () => {
    expect(DEFAULT_BEHAVIOR_PROMPT).toMatch(/at most one/i);
    expect(DEFAULT_BEHAVIOR_PROMPT).toMatch(/only the change/i);
  });

  it('keeps formatting minimal and mindful of the channel', () => {
    expect(DEFAULT_BEHAVIOR_PROMPT).toMatch(/prose/i);
    expect(DEFAULT_BEHAVIOR_PROMPT).toMatch(/chat apps/i);
  });

  it('owns mistakes without grovelling and reports outcomes faithfully', () => {
    expect(DEFAULT_BEHAVIOR_PROMPT).toMatch(/own it/i);
    expect(DEFAULT_BEHAVIOR_PROMPT).toMatch(/confirmed/i);
  });

  it('stays short: it rides on every turn', () => {
    expect(DEFAULT_BEHAVIOR_PROMPT.length).toBeLessThan(1600);
  });
});

describe('Agent behaviorPrompt', () => {
  afterEach(() => vi.restoreAllMocks());

  async function systemPromptFor(behaviorPrompt?: boolean): Promise<string> {
    let system = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: string }[];
      };
      system = body.messages.find((m) => m.role === 'system')?.content ?? '';
      return new Response(
        'data: {"choices":[{"delta":{"content":"ok"},"index":0}]}\n\n' +
          'data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    });
    const agent = Agent.create({
      apiKey: 'k',
      memory: { enabled: false },
      knowledge: { enabled: false },
      ...(behaviorPrompt !== undefined && { behaviorPrompt }),
    });
    await agent.chat('oi');
    await agent.destroy();
    return system;
  }

  it('is off by default: the operator persona stays in charge', async () => {
    expect(await systemPromptFor()).not.toContain('# How to respond');
  });

  it('adds the block when the operator opts in', async () => {
    expect(await systemPromptFor(true)).toContain('# How to respond');
  });
});
