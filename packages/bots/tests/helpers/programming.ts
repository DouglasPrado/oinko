/* eslint-disable @typescript-eslint/no-explicit-any -- runner replies are untyped JSON */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOpsLocally } from '@oinko/environments/workspace-ops';
import type { RunnerPort } from '../../src/programming/run-tools.js';

/**
 * Test double of the environment runner for simulated-provider suites: the
 * same workspace operations run in-process on a local worktree, and checks
 * are real child processes. The Docker suites use the shipped runner.
 */
export class LocalRunner implements RunnerPort {
  readonly calls: { action: string; correlation?: unknown }[] = [];
  readonly jobs = new Map<string, any>();
  readonly tasks = new Map<string, string>();
  private readonly baselines = new Map<string, any>();
  private sequence = 0;

  constructor(readonly worktree: string, taskId = 'fix') {
    this.tasks.set(taskId, 'ready');
  }

  private ops(request: Record<string, unknown>) {
    return (runOpsLocally({ ...request, root: this.worktree }) as Promise<any>).then((result) => {
      if (result?.error) throw Object.assign(new Error(result.error.message), { code: result.error.code, details: result.error.details });
      return result;
    });
  }

  async command<T>(command: any, options: { correlation?: unknown } = {}): Promise<T> {
    this.calls.push({ action: command.action, correlation: options.correlation });
    const { action, taskId: _task, repositoryId: _repo, ...rest } = command;
    void _task;
    void _repo;
    switch (action) {
      case 'state':
        return { jobs: [...this.jobs.values()], tasks: [...this.tasks].map(([id, state]) => ({ id, state })) } as T;
      case 'createTask': {
        this.tasks.set(command.definition.id, 'ready');
        const job = { id: `job-${++this.sequence}`, state: 'succeeded' };
        this.jobs.set(job.id, job);
        return job as T;
      }
      case 'searchPaths':
      case 'searchContent':
      case 'readRange':
      case 'projectContext':
        return this.ops({ op: action, ...rest });
      case 'gitSnapshot': {
        if (command.saveAs && this.baselines.has(command.saveAs)) return this.baselines.get(command.saveAs);
        const snapshot = await this.ops({ op: 'gitSnapshot' });
        if (command.saveAs) this.baselines.set(command.saveAs, snapshot);
        return snapshot;
      }
      case 'gitDiff':
        return this.ops({ op: 'gitDiff', baseline: command.baselineRef ? this.baselines.get(command.baselineRef) : command.baseline });
      case 'replaceExact':
        return (await this.apply([{ action: 'replace', path: command.path, expectedHash: command.expectedHash, oldText: command.oldText, newText: command.newText, replaceAll: command.replaceAll ?? false }])) as T;
      case 'applyPatch':
        return (await this.apply(command.edits)) as T;
      case 'reconcileEdit':
        return { found: false, state: 'unknown' } as T;
      case 'startCheck':
        return this.startCheck(command) as T;
      case 'inspectJob':
        return { job: this.jobs.get(command.jobId) } as T;
      case 'jobLogs':
        return { text: this.jobs.get(command.jobId)?.log ?? '' } as T;
      case 'stopJob': {
        const job = this.jobs.get(command.jobId);
        job?.child?.kill('SIGKILL');
        return { job, stopped: true } as T;
      }
      case 'shell': {
        try {
          const stdout = execFileSync('bash', ['-lc', command.command], { cwd: this.worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
          return { stdout, stderr: '', exitCode: 0 } as T;
        } catch (error: any) {
          return { stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? ''), exitCode: error.status ?? 1 } as T;
        }
      }
      default:
        throw new Error(`LocalRunner: ${action} não suportado`);
    }
  }

  private async apply(edits: unknown[]) {
    const plan = await this.ops({ op: 'planEdits', edits });
    if (!plan.ok) throw Object.assign(new Error('Nenhum arquivo foi alterado: pré-condições falharam.'), { code: 'edit_conflict', details: { files: plan.files } });
    const result = await this.ops({ op: 'applyEdits', edits });
    return { ok: true, applied: result.applied.map((file: any) => file.path), revision: result.revision };
  }

  private async startCheck(command: any) {
    const id = `job-${++this.sequence}`;
    const revisionBefore = (await this.ops({ op: 'treeHash' })).revision;
    const job: any = { id, type: 'check', state: 'running', log: '' };
    this.jobs.set(id, job);
    const child = spawn('bash', ['-lc', command.command], { cwd: join(this.worktree, command.cwd ?? '.') });
    job.child = child;
    child.stdout.on('data', (chunk) => (job.log += String(chunk)));
    child.stderr.on('data', (chunk) => (job.log += String(chunk)));
    child.on('close', async (code, signal) => {
      const revisionAfter = (await this.ops({ op: 'treeHash' })).revision;
      delete job.child;
      Object.assign(job, {
        state: 'succeeded',
        result: {
          kind: command.kind,
          exitCode: code,
          result: signal ? 'cancelled' : code === 0 ? 'passed' : code === 127 ? 'infrastructure' : 'failed',
          classification: code === 0 || code === 1 ? 'code' : 'environment',
          revisionBefore,
          revisionAfter,
          stale: revisionAfter !== revisionBefore,
          outputTail: job.log.slice(-4000),
        },
      });
    });
    return { id, state: 'running' };
  }
}

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
