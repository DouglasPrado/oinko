// Test worker: the real bot runtime (runBot) with a scripted model provider.
// It runs as its own process so tests can crash it with SIGKILL.
import { BotStore } from '../../dist/store.js';
import { runBot } from '../../dist/runner.js';

const [root, botId, mode = 'bug'] = process.argv.slice(2);

/** Next action from the persisted run thread: count of tool results so far. */
function step(messages) {
  const system = messages.find((message) => message.role === 'system')?.content ?? '';
  if (!String(system).includes('trabalho de programação durável')) return { text: 'ok' };
  const tools = messages.filter((message) => message.role === 'tool');
  let last;
  try {
    last = tools.at(-1) ? JSON.parse(tools.at(-1).content) : undefined;
  } catch {
    last = undefined; // control tools answer in plain text
  }
  const slow = mode === 'slow-check' ? 'sleep 20 && ' : '';
  const script = [
    () => ({ tool: 'workspace_prepare_task', args: { name: 'Corrigir soma' } }),
    () => ({ tool: 'workspace_context', args: { targets: ['sum.cjs'] } }),
    () => ({ tool: 'workspace_check', args: { kind: 'test', command: 'node sum.test.cjs' } }),
    () => ({ tool: 'workspace_read_range', args: { path: 'sum.cjs' } }),
    () => ({ tool: 'workspace_replace', args: { path: 'sum.cjs', expectedHash: last.hash, oldText: 'a - b', newText: 'a + b' } }),
    () => ({ tool: 'workspace_check', args: { kind: 'test', command: `${slow}node sum.test.cjs` } }),
    () => ({ tool: 'workspace_diff', args: {} }),
    () => ({ tool: 'programming_complete', args: { summary: 'Soma corrigida com teste.' } }),
  ];
  const next = script[tools.length];
  return next ? next() : { text: 'Trabalho concluído com evidência.' };
}

async function fetchImpl(request) {
  const body = await request.json();
  const action = step(body.messages);
  const frames =
    'tool' in action
      ? [
          { id: 'gen-x', choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${Date.now()}-${Math.random()}`, function: { name: action.tool, arguments: JSON.stringify(action.args) } }] }, index: 0 }] },
          { choices: [{ finish_reason: 'tool_calls', index: 0 }] },
          { choices: [], usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 } },
        ]
      : [
          { id: 'gen-y', choices: [{ delta: { content: action.text }, index: 0 }] },
          { choices: [{ finish_reason: 'stop', index: 0 }] },
        ];
  return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const store = new BotStore(root);
await runBot(store, botId, () => store.close(), { fetch: fetchImpl });
process.send?.({ ready: true, pid: process.pid });
