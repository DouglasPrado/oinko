import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { Agent } from '../../src/agent.js';

const sse = (frames: unknown[]): Response =>
  new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
const callTool = (name: string) =>
  sse([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name, arguments: '{}' } }] }, index: 0 }] },
    { choices: [{ finish_reason: 'tool_calls', index: 0 }] },
  ]);
const answer = () =>
  sse([
    { choices: [{ delta: { content: 'ok' }, index: 0 }] },
    { choices: [{ finish_reason: 'stop', index: 0 }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } },
  ]);

/**
 * Um host que roda trabalhos com permissões diferentes (um projeto sem
 * navegador, outro com) precisa esconder ferramentas de uma execução sem
 * desregistrá-las do agente: o modelo não as vê e, se chamar mesmo assim,
 * elas não rodam.
 */
describe('Agent — ferramentas escondidas por execução', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('esconde da execução e recusa a chamada, sem afetar a execução seguinte', async () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-hidden-'));
    roots.push(root);
    const requests: { tools?: { function: { name: string } }[] }[] = [];
    const replies = [callTool('browser_open'), answer(), answer()];
    const agent = Agent.create({
      apiKey: 'chave-de-teste',
      model: 'modelo',
      memory: { enabled: false },
      knowledge: { enabled: false },
      dbPath: join(root, 'agent.db'),
      logLevel: 'silent',
      fetch: async (request: Request) => {
        requests.push((await request.json()) as (typeof requests)[number]);
        return replies.shift()!;
      },
    });
    const ran: string[] = [];
    for (const name of ['workspace_read', 'browser_open'])
      agent.addTool({
        name,
        description: `ferramenta ${name}`,
        parameters: z.object({}),
        execute: async () => {
          ran.push(name);
          return { content: 'ok' };
        },
      });
    try {
      const results: { isError?: boolean }[] = [];
      for await (const event of agent.stream('abra o navegador', { threadId: 't1', hiddenTools: ['browser_open'] }))
        if (event.type === 'tool_call_end') results.push(event.result);
      const offered = (index: number) => (requests[index]!.tools ?? []).map((tool) => tool.function.name);
      expect(offered(0)).toContain('workspace_read');
      expect(offered(0)).not.toContain('browser_open');
      expect(ran).toEqual([]);
      expect(results[0]?.isError).toBe(true);
      for await (const _event of agent.stream('de novo', { threadId: 't2' })) void _event;
      expect(offered(2)).toContain('browser_open');
    } finally {
      await agent.destroy();
    }
  });
});
