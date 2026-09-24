import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '../../src/agent.js';
import { SQLiteDatabase } from '../../src/storage/sqlite-database.js';
import { SQLiteConversationStore } from '../../src/storage/sqlite-conversation-store.js';
import type { ContextLifecycleEvent } from '../../src/contracts/entities/working-context.js';
import { createSSEResponse, textResponseFrames } from './helpers.js';

const agents: Agent[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.destroy()));
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

interface Body {
  messages: { role: string; content: string }[];
}
const isSummary = (body: Body) => String(body.messages[0]?.content ?? '').startsWith('Maintain a factual working summary');
const long = (label: string) => `${label} ${'detalhe do pedido '.repeat(120)}`;

function setup(options: { mode?: 'inline' | 'background'; summary?: (body: Body) => Promise<Response>; dbPath?: string; enabled?: boolean; store?: SQLiteConversationStore } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'oinko-bg-summary-'));
  dirs.push(dir);
  const chats: Body[] = [];
  const events: ContextLifecycleEvent[] = [];
  const agent = Agent.create({
    apiKey: 'test',
    model: 'main',
    memory: { enabled: false },
    knowledge: { enabled: false },
    logLevel: 'silent',
    dbPath: options.dbPath ?? join(dir, 'data.db'),
    ...(options.store && { conversation: { store: options.store } }),
    context: {
      enabled: options.enabled ?? true,
      maxInputTokens: 4096,
      recentTokens: 512,
      summaryTokens: 256,
      selectTools: false,
      summaryMode: options.mode ?? 'background',
    },
    contextEvents: (event) => events.push(event),
    fetch: async (request) => {
      const body = (await request.json()) as Body;
      if (isSummary(body)) return options.summary ? options.summary(body) : createSSEResponse(textResponseFrames({ content: 'Resumo: o usuário pediu vários detalhes.' }));
      chats.push(body);
      return createSSEResponse(textResponseFrames({ content: 'ok' }));
    },
  });
  agents.push(agent);
  return { agent, chats, events, dir };
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

describe('E2E background context summary', () => {
  it('answers at once with the recent window, then summarizes and uses the summary next turn', async () => {
    const hold = gate();
    const { agent, chats, events } = setup({
      summary: async () => {
        await hold.opened;
        return createSSEResponse(textResponseFrames({ content: 'Resumo: pedidos 1 a 3 feitos.' }));
      },
    });
    for (const n of [1, 2, 3, 4]) await agent.chat(long(`pedido-${n}`), { threadId: 't' });
    const stream: string[] = [];
    for await (const event of agent.stream(long('pedido-5'), { threadId: 't' }))
      if (event.type === 'warning') stream.push(event.code);
    expect(stream).toContain('context_preparation_pending');
    const fifth = JSON.stringify(chats.at(-1)!.messages);
    expect(fifth).not.toContain('pedido-1 ');
    expect(fifth).toContain('still being summarized');
    expect(fifth).toContain('pedido-5');
    hold.open();
    expect((await agent.prepareContext('t'))?.status).toMatch(/finished|discarded/);
    await agent.chat('e agora?', { threadId: 't' });
    expect(JSON.stringify(chats.at(-1)!.messages)).toContain('[Working summary of earlier conversation');
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['summary_scheduled', 'summary_finished']));
    // The full history is preserved: summaries never delete messages.
    expect(agent.getHistory('t').filter((message) => message.role === 'user')).toHaveLength(6);
  });

  it('discards a summary made stale by a reset during its execution', async () => {
    const hold = gate();
    const { agent, events } = setup({
      summary: async () => {
        await hold.opened;
        return createSSEResponse(textResponseFrames({ content: 'Resumo antigo.' }));
      },
    });
    for (const n of [1, 2, 3, 4]) await agent.chat(long(`pedido-${n}`), { threadId: 'r' });
    const pending = agent.prepareContext('r');
    agent.clearHistory('r');
    hold.open();
    const outcome = await pending;
    expect(outcome?.status).toBe('discarded');
    expect(events.some((event) => event.type === 'summary_discarded')).toBe(true);
    expect(agent.getCheckpoint('r')).toBeUndefined();
  });

  it('keeps the safe path and reports a failed summary without losing the turn', async () => {
    // 400 is not retried: the failure is immediate and final for this attempt.
    const { agent, chats, events } = setup({ summary: async () => new Response('bad request', { status: 400 }) });
    for (const n of [1, 2, 3, 4]) await agent.chat(long(`pedido-${n}`), { threadId: 'f' });
    const outcome = await agent.prepareContext('f');
    expect(outcome?.status).toBe('failed');
    expect(events.some((event) => event.type === 'summary_failed')).toBe(true);
    expect(await agent.chat('ainda responde?', { threadId: 'f' })).toBe('ok');
    expect(JSON.stringify(chats.at(-1)!.messages)).toContain('still being summarized');
  });

  it('prepares an old conversation when the policy is turned on later', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oinko-bg-old-'));
    dirs.push(dir);
    const database = new SQLiteDatabase(join(dir, 'conversations.db'));
    database.initialize();
    const store = new SQLiteConversationStore(database);
    const first = setup({ enabled: false, store });
    for (const n of [1, 2, 3, 4]) await first.agent.chat(long(`antigo-${n}`), { threadId: 'old' });
    const second = setup({ store });
    const outcome = await second.agent.prepareContext('old');
    expect(outcome?.status).toBe('finished');
    expect(second.agent.getCheckpoint('old')?.summary).toContain('Resumo');
  });

  it('keeps inline mode unchanged: the summary is made before answering', async () => {
    const { agent, chats } = setup({ mode: 'inline' });
    for (const n of [1, 2, 3, 4, 5]) await agent.chat(long(`pedido-${n}`), { threadId: 'i' });
    expect(JSON.stringify(chats.at(-1)!.messages)).toContain('[Working summary of earlier conversation');
  });
});

describe('E2E background summary: races, retries and budgets', () => {
  it('serializes summaries of one conversation and never overlaps them', async () => {
    let active = 0;
    let peak = 0;
    const hold = gate();
    const { agent } = setup({
      summary: async () => {
        active++;
        peak = Math.max(peak, active);
        await hold.opened;
        active--;
        return createSSEResponse(textResponseFrames({ content: 'Resumo serializado.' }));
      },
    });
    for (const n of [1, 2, 3, 4]) await agent.chat(long(`pedido-${n}`), { threadId: 's' });
    const first = agent.prepareContext('s');
    for (const n of [5, 6]) await agent.chat(long(`pedido-${n}`), { threadId: 's' });
    const second = agent.prepareContext('s');
    hold.open();
    await Promise.all([first, second]);
    expect(peak).toBe(1);
    expect(agent.getCheckpoint('s')?.summary).toContain('Resumo serializado');
  });

  it('keeps a message sent while the summary runs and uses both next turn', async () => {
    const hold = gate();
    const { agent, chats } = setup({
      summary: async () => {
        await hold.opened;
        return createSSEResponse(textResponseFrames({ content: 'Resumo dos pedidos antigos.' }));
      },
    });
    for (const n of [1, 2, 3, 4]) await agent.chat(long(`pedido-${n}`), { threadId: 'n' });
    const pending = agent.prepareContext('n');
    await agent.chat('mensagem nova durante o resumo', { threadId: 'n' });
    hold.open();
    expect((await pending)?.status).toBe('finished');
    await agent.chat('e agora?', { threadId: 'n' });
    const sent = JSON.stringify(chats.at(-1)!.messages);
    expect(sent).toContain('Resumo dos pedidos antigos.');
    expect(sent).toContain('mensagem nova durante o resumo');
  });

  it('retries a summary once the provider comes back', async () => {
    let calls = 0;
    const { agent, events } = setup({
      summary: async () => (++calls === 1 ? new Response('unavailable', { status: 503 }) : createSSEResponse(textResponseFrames({ content: 'Resumo após retry.' }))),
    });
    for (const n of [1, 2, 3, 4]) await agent.chat(long(`pedido-${n}`), { threadId: 'rt' });
    expect((await agent.prepareContext('rt'))?.status).toBe('finished');
    expect(calls).toBeGreaterThanOrEqual(2); // the 503 was retried; a replanned range may add one more
    expect(events.some((event) => event.type === 'summary_finished')).toBe(true);
  }, 20_000);
});

describe('E2E per-model context budgets and history isolation', () => {
  it('gives the fast model its own smaller budget and the main model the full one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oinko-budget-'));
    dirs.push(dir);
    const requests: { model: string; chars: number }[] = [];
    const agent = Agent.create({
      apiKey: 'test',
      model: 'main',
      memory: { enabled: false },
      knowledge: { enabled: false },
      logLevel: 'silent',
      dbPath: join(dir, 'data.db'),
      context: { enabled: true, maxInputTokens: 16_000, fastInputTokens: 2048, recentTokens: 1024, summaryTokens: 256, selectTools: false, summaryMode: 'background' },
      routing: { fastModel: 'fast', minConfidence: 0.8 },
      decider: {
        decide: async (state: string, questions: Record<string, unknown>) =>
          Object.fromEntries(Object.keys(questions).map((key) => [key, key === 'tier' ? { value: state.includes('rápido') ? 'fast' : 'capable', confidence: 1 } : { value: false, confidence: 1 }])),
      } as never,
      fetch: async (request) => {
        const body = (await request.json()) as Body & { model: string };
        if (!isSummary(body)) requests.push({ model: body.model, chars: JSON.stringify(body.messages).length });
        return createSSEResponse(textResponseFrames({ content: 'ok' }));
      },
    });
    agents.push(agent);
    for (const n of [1, 2, 3, 4, 5, 6]) await agent.chat(long(`contexto-${n}`), { threadId: 'b' });
    await agent.chat('responda rápido: ok?', { threadId: 'b' });
    await agent.chat('agora com calma, revise tudo', { threadId: 'b' });
    const fast = requests.filter((item) => item.model === 'fast').at(-1)!;
    const main = requests.filter((item) => item.model === 'main').at(-1)!;
    expect(fast).toBeDefined();
    expect(fast.chars).toBeLessThan(main.chars);
    expect(fast.chars).toBeLessThan(2048 * 4 * 1.5);
  });

  it('never lets one bot read another bot conversation history', async () => {
    const a = setup();
    const b = setup();
    await b.agent.chat('segredo operacional do bot B', { threadId: 'shared-id' });
    expect(JSON.stringify(a.agent.getHistory('shared-id'))).not.toContain('segredo operacional do bot B');
    expect(JSON.stringify(b.agent.getHistory('shared-id'))).toContain('segredo operacional do bot B');
  });
});
