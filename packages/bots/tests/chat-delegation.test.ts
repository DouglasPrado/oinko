import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BotManager, BotStore } from '../src/index.js';
import { runBot } from '../src/runner.js';
import { chatProgramming, DURABLE_ONLY_MCP_TOOLS } from '../src/programming/chat-setup.js';
import { scopeOinkoMcp } from '../src/programming/equivalence.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Body {
  tools?: { function: { name: string } }[];
  messages: { role: string; content: string }[];
}

async function firstChatRequest(programmingPolicy?: { enabled: boolean }) {
  const root = mkdtempSync(join(tmpdir(), 'oinko-chat-delegation-'));
  roots.push(root);
  const store = new BotStore(root);
  store.save(
    { id: 'dev', name: 'Dev', model: 'main-model', systemPrompt: 'Você é o Dev.', programming: true, ...(programmingPolicy && { programmingPolicy }) },
    { apiKey: 'sk-test-0123456789abcdef' },
    0,
  );
  const requests: Body[] = [];
  const service = await runBot(store, 'dev', () => {}, {
    fetch: async (request) => {
      requests.push((await request.json()) as Body);
      return new Response(
        'data: {"choices":[{"delta":{"content":"ok"},"index":0}]}\n\n' +
          'data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    },
  });
  try {
    await new BotManager(store).message('dev', 'delegation-test', 'Tema dark, criar novo pode iniciar');
  } finally {
    await service.close();
    store.close();
  }
  const body = requests[0]!;
  return { tools: (body.tools ?? []).map((tool) => tool.function.name), system: body.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n') };
}

describe('chat delegation of programming work', () => {
  it('with durable runs, the chat can only inspect and must start a run to change code', async () => {
    const { tools, system } = await firstChatRequest({ enabled: true });
    expect(tools).toEqual(expect.arrayContaining(['programming_start', 'programming_status', 'programming_steer', 'programming_control', 'workspace_status', 'workspace_read', 'workspace_logs']));
    for (const mutating of ['workspace_task', 'workspace_exec', 'workspace_write', 'workspace_preview']) expect(tools, mutating).not.toContain(mutating);
    expect(system).toContain('programming_start');
    expect(system).toMatch(/nunca diga que vai retornar/i);
    // The old instructions that told the chat to create tasks and edit are gone.
    expect(system).not.toContain('Crie uma tarefa/worktree e aguarde seu job concluir antes de editar');
  }, 30_000);

  it('without durable runs, the chat keeps its tools but never promises to come back later', async () => {
    const { tools, system } = await firstChatRequest();
    expect(tools).toEqual(expect.arrayContaining(['workspace_task', 'workspace_exec', 'workspace_write']));
    expect(tools).not.toContain('programming_start');
    expect(system).toMatch(/não prometa voltar depois/i);
  }, 30_000);

  it('keeps workspace-changing Oinko MCP tools out of the chat when durable runs exist', () => {
    const setup = chatProgramming({ programming: true, programmingPolicy: { enabled: true } as never });
    const scoped = scopeOinkoMcp('dev', ['/repo/packages/mcps/oinko/dist/cli.js'], setup.internalTools, setup.mcpExcluded);
    for (const name of DURABLE_ONLY_MCP_TOOLS) expect(scoped.tools, name).not.toContain(name);
    expect(scoped.tools).toEqual(expect.arrayContaining(['oinko_run_explain', 'oinko_artifact', 'oinko_job']));
    const legacy = chatProgramming({ programming: true });
    expect(scopeOinkoMcp('dev', ['cli.js'], legacy.internalTools, legacy.mcpExcluded).tools).toContain('oinko_sandbox');
  });
});
