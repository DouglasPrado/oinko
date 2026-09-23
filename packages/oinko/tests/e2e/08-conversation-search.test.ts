import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../../src/agent.js';
import {
  createSSEResponse,
  scriptFetch,
  consumeStream,
  textResponseFrames,
  toolCallFrames,
} from './helpers.js';

const text = (content: string) => createSSEResponse(textResponseFrames({ content }));
const search = (id: string, query: string) =>
  createSSEResponse(
    toolCallFrames({
      toolCallId: id,
      name: 'ConversationSearch',
      arguments: JSON.stringify({ query }),
    }),
  );

interface Body {
  messages: { role: string; content: string }[];
  tools?: { function: { name: string } }[];
}

/** The ConversationSearch result the model received, without the «match» marks. */
const searchResult = (body: Body): string =>
  (body.messages.find((m) => m.role === 'tool')?.content ?? '').replace(/[«»]/g, '');

describe('E2E 08 — conversation search', () => {
  let tempDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  const create = (dbPath: string) =>
    Agent.create({
      apiKey: 'test-key',
      baseUrl: 'https://api.test/v1',
      logLevel: 'silent',
      dbPath,
      memory: { enabled: false },
      knowledge: { enabled: true },
      conversation: { search: { enabled: true } },
    });

  it('finds an earlier message of this thread — and nothing from another thread or this turn', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'harness-e2e-search-'));
    const { chatRequests } = scriptFetch({
      chat: [
        text('anotado'),
        text('anotado'),
        search('c1', 'marcador ZEBRA'),
        text('no bucket azul'),
      ],
    });
    const agent = create(join(tempDir, 'agent.db'));

    await consumeStream(
      agent.stream('o marcador ZEBRA-77 fica no bucket azul', { threadId: 't1' }),
    );
    await consumeStream(agent.stream('meu marcador ZEBRA-99 é segredo', { threadId: 't2' }));
    await consumeStream(agent.stream('onde fica o marcador ZEBRA?', { threadId: 't1' }));
    await agent.destroy();

    const first = chatRequests[0] as Body;
    expect(first.tools?.map((t) => t.function.name)).toContain('ConversationSearch');
    expect(first.messages[0]!.content).toContain('# Earlier conversations');

    const result = searchResult(chatRequests[3] as Body);
    expect(result).toContain('ZEBRA-77');
    expect(result).not.toContain('ZEBRA-99');
    expect(result).not.toContain('onde fica');
  });

  it('still finds the previous message when the next turn starts in the same millisecond', async () => {
    // A frozen clock puts every write in the same millisecond — what a fast
    // host does by chance. The cut that keeps this turn out must not also
    // swallow the message written just before it.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    tempDir = await mkdtemp(join(tmpdir(), 'harness-e2e-search-'));
    const { chatRequests } = scriptFetch({
      chat: [text('anotado'), search('c1', 'girassol'), text('achei')],
    });
    const agent = create(join(tempDir, 'agent.db'));
    try {
      await consumeStream(agent.stream('a senha é girassol', { threadId: 't1' }));
      await consumeStream(agent.stream('qual a senha do girassol?', { threadId: 't1' }));
    } finally {
      await agent.destroy();
      vi.useRealTimers();
    }

    const result = searchResult(chatRequests[2] as Body);
    expect(result).toContain('a senha é girassol');
    expect(result).not.toContain('qual a senha');
  });

  it('keeps finding it after a restart, and stops after the thread is cleared', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'harness-e2e-search-'));
    const dbPath = join(tempDir, 'agent.db');
    const { chatRequests } = scriptFetch({
      chat: [
        text('anotado'),
        search('c1', 'orquídea'),
        text('achei'),
        search('c2', 'orquídea'),
        text('nada'),
      ],
    });

    const a = create(dbPath);
    await consumeStream(a.stream('a senha do cofre é a flor orquídea', { threadId: 't1' }));
    await a.destroy();

    const b = create(dbPath);
    await consumeStream(b.stream('qual era a flor?', { threadId: 't1' }));
    expect(searchResult(chatRequests[2] as Body)).toContain('flor orquídea');

    b.clearHistory('t1');
    await consumeStream(b.stream('e a flor?', { threadId: 't1' }));
    await b.destroy();
    expect(searchResult(chatRequests[4] as Body)).toMatch(/no matching messages/i);
  });

  it('keeps two threads searching at the same time apart', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'harness-e2e-search-'));
    const results: string[] = [];
    // Answers by content, not by order: the two turns interleave.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/embeddings')) {
        return new Response(JSON.stringify({ data: [{ embedding: [0, 0, 0, 0] }] }), {
          status: 200,
        });
      }
      const body = JSON.parse(String(init?.body)) as Body;
      const last = body.messages[body.messages.length - 1]!;
      if (last.role === 'tool') {
        results.push(last.content);
        return text('ok');
      }
      return String(last.content).includes('qual')
        ? search(`c-${Math.random()}`, 'cor')
        : text('anotado');
    });

    const agent = create(join(tempDir, 'agent.db'));
    await consumeStream(agent.stream('minha cor é AZUL-A', { threadId: 'ta' }));
    await consumeStream(agent.stream('minha cor é VERDE-B', { threadId: 'tb' }));
    await Promise.all([
      consumeStream(agent.stream('qual a cor?', { threadId: 'ta' })),
      consumeStream(agent.stream('qual a cor?', { threadId: 'tb' })),
    ]);
    await agent.destroy();

    expect(results).toHaveLength(2);
    const fromA = results.find((r) => r.includes('AZUL-A'))!;
    const fromB = results.find((r) => r.includes('VERDE-B'))!;
    expect(fromA).not.toContain('VERDE-B');
    expect(fromB).not.toContain('AZUL-A');
  });

  it('refuses to start with a store that cannot search', () => {
    expect(() =>
      Agent.create({
        apiKey: 'test-key',
        memory: { enabled: false },
        knowledge: { enabled: false },
        conversation: {
          store: {
            appendMessage: () => {},
            listThread: () => [],
            listPinned: () => [],
            clearThread: () => {},
          },
          search: { enabled: true },
        },
      }),
    ).toThrow(/searchMessages/);
  });

  it('stays off unless enabled', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'harness-e2e-search-'));
    const { chatRequests } = scriptFetch({ chat: [text('oi')] });
    const agent = Agent.create({
      apiKey: 'test-key',
      baseUrl: 'https://api.test/v1',
      logLevel: 'silent',
      dbPath: join(tempDir, 'agent.db'),
      memory: { enabled: false },
      knowledge: { enabled: true },
    });
    await consumeStream(agent.stream('oi', { threadId: 't1' }));
    await agent.destroy();

    const body = chatRequests[0] as Body;
    expect((body.tools ?? []).map((t) => t.function.name)).not.toContain('ConversationSearch');
    expect(body.messages[0]!.content).not.toContain('# Earlier conversations');
  });
});
