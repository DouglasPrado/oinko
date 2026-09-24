/* eslint-disable @typescript-eslint/no-explicit-any -- runner replies are untyped JSON */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export { LocalRunner } from '../../src/programming/evaluation/local-runner.js';

export function gitRepo(files: Record<string, string>) {
  const base = mkdtempSync(join(tmpdir(), 'oinko-bot-run-'));
  const worktree = join(base, 'worktree');
  mkdirSync(worktree, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(worktree, file, '..'), { recursive: true });
    writeFileSync(join(worktree, file), content);
  }
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: worktree });
  execFileSync('git', ['add', '-A'], { cwd: worktree });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@l', 'commit', '-q', '-m', 'init'], { cwd: worktree });
  return { base, worktree, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

type Message = { role: string; content: string | null; tool_calls?: unknown[] };
export type ScriptStep = { tool: string; args: Record<string, unknown> } | { text: string };

/**
 * OpenRouter-shaped SSE provider driven by a function of the conversation:
 * the script sees previous tool results (e.g. a file hash) and decides the
 * next call, like a model would.
 */
export function scriptedProvider(script: (messages: Message[], call: number) => ScriptStep): {
  fetch: (request: Request) => Promise<Response>;
  requests: { model: string; messages: Message[] }[];
} {
  let call = 0;
  const requests: { model: string; messages: Message[] }[] = [];
  const fetch = async (request: Request) => {
    const body = (await request.json()) as { model: string; messages: Message[] };
    requests.push(body);
    const step = script(body.messages, call++);
    const frames =
      'tool' in step
        ? [
            { id: `gen-${call}`, choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${call}`, function: { name: step.tool, arguments: JSON.stringify(step.args) } }] }, index: 0 }] },
            { choices: [{ finish_reason: 'tool_calls', index: 0 }] },
            { choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, cost: 0.0001 } },
          ]
        : [
            { id: `gen-${call}`, choices: [{ delta: { content: step.text }, index: 0 }] },
            { choices: [{ finish_reason: 'stop', index: 0 }] },
            { choices: [], usage: { prompt_tokens: 80, completion_tokens: 8, total_tokens: 88 } },
          ];
    return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
  return { fetch, requests };
}

/** Last tool result in the conversation, parsed. */
export function lastResult(messages: Message[]): any {
  const tool = messages.filter((message) => message.role === 'tool').at(-1);
  try {
    return tool ? JSON.parse(String(tool.content)) : undefined;
  } catch {
    return undefined;
  }
}
