import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../../src/agent.js';
import type { ContentPart } from '../../src/contracts/entities/content-part.js';

const SSE = [
  'data: {"choices":[{"delta":{"content":"ok"},"index":0}]}\n\n',
  'data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
].join('');

const IMAGE_URL = 'https://x.test/cat.png';

/**
 * The whole point of this file is the wire, not the reply: the multimodal type
 * existed and was accepted at the door, but the context builder rewrote every
 * image as the text `[image: <url>]`, so no vision model ever received one.
 * Only a test that reads the request body can tell the two apart.
 */
describe('Agent with image input', () => {
  const created: { agent: Agent; root: string }[] = [];

  function createAgent(model: string): { agent: Agent; turns: () => Record<string, unknown>[] } {
    const root = mkdtempSync(join(tmpdir(), 'harness-vision-'));
    const bodies: Record<string, unknown>[] = [];

    const agent = Agent.create({
      apiKey: 'test-key',
      model,
      memory: { enabled: false },
      knowledge: { enabled: false },
      dbPath: join(root, 'agent.db'),
      logLevel: 'silent',
      fetch: async (request: Request) => {
        bodies.push(JSON.parse(await request.text()) as Record<string, unknown>);
        return new Response(SSE, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });

    created.push({ agent, root });
    // Streaming bodies only — the turn is the one that carries `stream: true`.
    return { agent, turns: () => bodies.filter((b) => b.stream === true) };
  }

  const input: ContentPart[] = [
    { type: 'text', text: 'What is in this image?' },
    { type: 'image_url', image_url: { url: IMAGE_URL, detail: 'high' } },
  ];

  function userContent(body: Record<string, unknown>): unknown {
    const messages = body.messages as { role: string; content: unknown }[];
    return messages.filter((m) => m.role === 'user').at(-1)?.content;
  }

  afterEach(async () => {
    for (const { agent, root } of created.splice(0)) {
      await agent.destroy();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('sends the image to a model that can see it', async () => {
    const { agent, turns } = createAgent('gpt-4o');
    await agent.chat(input, { threadId: 't1' });

    expect(userContent(turns()[0]!)).toEqual([
      { type: 'text', text: 'What is in this image?' },
      { type: 'image_url', image_url: { url: IMAGE_URL, detail: 'high' } },
    ]);
  });

  it('flattens the image for a text-only model instead of failing the turn', async () => {
    const { agent, turns } = createAgent('deepseek/deepseek-chat');
    await agent.chat(input, { threadId: 't1' });

    const content = userContent(turns()[0]!);
    expect(typeof content).toBe('string');
    expect(content).toContain(`[image: ${IMAGE_URL}]`);
  });

  /**
   * The image has to survive the round trip through storage, or it would work
   * on the turn it arrived and vanish from every turn after — the shape that
   * looks like the model forgetting rather than like a bug.
   */
  it('keeps the image in context on later turns of the same thread', async () => {
    const { agent, turns } = createAgent('gpt-4o');
    await agent.chat(input, { threadId: 'same' });
    await agent.chat('And what colour is it?', { threadId: 'same' });

    const second = turns()[1]!;
    const messages = second.messages as { role: string; content: unknown }[];
    const first = messages.find((m) => m.role === 'user')!;

    expect(Array.isArray(first.content)).toBe(true);
    expect(JSON.stringify(first.content)).toContain(IMAGE_URL);
  });
});
