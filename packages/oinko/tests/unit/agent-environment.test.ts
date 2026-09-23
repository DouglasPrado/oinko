import { describe, it, expect, vi, afterEach } from 'vitest';
import { Agent } from '../../src/agent.js';

function captureSystemPrompts(): string[] {
  const systems: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: { role: string; content: string }[];
    };
    systems.push(body.messages.find((m) => m.role === 'system')?.content ?? '');
    return new Response(
      'data: {"choices":[{"delta":{"content":"ok"},"index":0}]}\n\n' +
        'data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  });
  return systems;
}

describe('Agent environment — local date and time', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('tells the model the date where the user is, not in UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T02:30:00Z'));
    const systems = captureSystemPrompts();
    const agent = Agent.create({
      apiKey: 'k',
      memory: { enabled: false },
      knowledge: { enabled: false },
      timezone: 'America/Sao_Paulo',
    });

    await agent.chat('que dia é hoje?');
    await agent.destroy();

    expect(systems[0]).toContain('- Date: 2026-09-23 (Wednesday)');
    expect(systems[0]).toContain('- Time: 23:30 (America/Sao_Paulo)');
  });

  it('rejects a time zone that does not exist', () => {
    expect(() =>
      Agent.create({ apiKey: 'k', memory: { enabled: false }, timezone: 'Mars/Olympus' }),
    ).toThrow();
  });
});
