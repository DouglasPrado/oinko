import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { runOpsLocally } from '@oinko/environments/workspace-ops';
import type { RunnerPort } from '../tool-kit.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- runner replies are untyped JSON */

interface Job {
  id: string;
  type?: string;
  state: string;
  log?: string;
  result?: Record<string, unknown>;
  child?: ChildProcess;
}

/**
 * SIMULATED environment runner for evaluations and tests: the same workspace
 * operations as the sandbox run in-process on a local Git worktree, checks
 * are child processes, and the preview/browser pair renders the worktree's
 * HTML as text. It never isolates code — use it only with deterministic
 * (simulated) models; real providers must go through the Docker runner.
 */
export class LocalRunner implements RunnerPort {
  readonly calls: { action: string; correlation?: unknown }[] = [];
  private readonly taskBranches = new Map<string, string>();
  readonly jobs = new Map<string, any>();
  readonly tasks = new Map<string, string>();
  private readonly baselines = new Map<string, any>();
  private sequence = 0;
  private page = '';
  private previewTask?: string;

  constructor(
    readonly worktree: string,
    taskId = 'fix',
    readonly options: { projectId?: string; environmentId?: string } = {},
  ) {
    this.tasks.set(taskId, 'ready');
  }

  private get previewUrl() {
    return `http://${this.previewTask ?? 'none'}.${this.options.projectId ?? 'project'}.preview.test`;
  }

  private ops(request: Record<string, unknown>) {
    return (runOpsLocally({ ...request, root: this.worktree }) as Promise<any>).then((result) => {
      if (result?.error) throw Object.assign(new Error(result.error.message), { code: result.error.code, details: result.error.details });
      return result;
    });
  }

  /** Visible text of the worktree's HTML files, as a build would have served them. */
  private render(): string {
    const texts: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === '.git' || entry === 'node_modules') continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (entry.endsWith('.html'))
          texts.push(
            readFileSync(path, 'utf8')
              .replace(/<script[\s\S]*?<\/script>/g, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim(),
          );
      }
    };
    walk(this.worktree);
    return texts.join('\n');
  }

  async command<T>(command: any, options: { correlation?: unknown } = {}): Promise<T> {
    this.calls.push({ action: command.action, correlation: options.correlation });
    const { action, taskId: _task, repositoryId: _repo, ...rest } = command;
    void _task;
    void _repo;
    switch (action) {
      case 'state':
        return {
          jobs: [...this.jobs.values()].map((job: Job) => this.view(job)),
          tasks: [...this.tasks].map(([id, state]) => ({ id, state, branch: `oinko/${id}` })),
          projects: [{ id: this.options.projectId ?? 'project', environmentId: this.options.environmentId ?? 'web' }],
          environments: [{ id: this.options.environmentId ?? 'web', name: 'Simulado' }],
          previews: this.previewTask
            ? [{ id: this.previewTask, taskId: this.previewTask, projectId: this.options.projectId ?? 'project', environmentId: this.options.environmentId ?? 'web', state: 'ready', urls: [{ serviceId: 'web', url: this.previewUrl }] }]
            : [],
        } as T;
      case 'createTask': {
        // Like the runner: an ID is reusable only after a failure and with the same branch,
        // and git refuses a branch that already exists (the fixture's own `main`).
        const { id, branch } = command.definition as { id: string; branch: string };
        const previous = this.taskBranches.get(id);
        if (previous !== undefined && (previous !== branch || this.tasks.get(id) !== 'failed'))
          throw Object.assign(new Error('ID de tarefa já utilizado.'), { code: 'task_exists' });
        this.taskBranches.set(id, branch);
        const exists = branch === 'main';
        this.tasks.set(id, exists ? 'failed' : 'ready');
        const job = { id: `job-${++this.sequence}`, state: exists ? 'failed' : 'succeeded', ...(exists && { error: `fatal: a branch named '${branch}' already exists` }) };
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
        return { job: this.view(this.jobs.get(command.jobId)) } as T;
      case 'jobLogs':
        return { text: this.jobs.get(command.jobId)?.log ?? '' } as T;
      case 'stopJob': {
        const job = this.jobs.get(command.jobId);
        job?.child?.kill('SIGKILL');
        return { job: this.view(job), stopped: true } as T;
      }
      case 'shell': {
        try {
          const stdout = execFileSync('bash', ['-lc', command.command], { cwd: this.worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
          return { stdout, stderr: '', exitCode: 0 } as T;
        } catch (error: any) {
          return { stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? ''), exitCode: error.status ?? 1 } as T;
        }
      }
      // Simulated preview: the page is what the worktree served at build time.
      case 'startPreview': {
        this.previewTask = command.taskId;
        this.page = this.render() || ' ';
        const job = { id: `job-${++this.sequence}`, type: 'preview', state: 'succeeded' };
        this.jobs.set(job.id, job);
        return job as T;
      }
      case 'previewLogs':
        return { text: 'simulated preview' } as T;
      case 'browserSession':
        return {
          sessionId: `bs-${createHash('sha256').update(`${command.runId}:${command.kind}:${++this.sequence}`).digest('hex').slice(0, 24)}`,
          kind: command.kind,
          viewport: command.mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
          image: 'simulated',
          chromiumVersion: 'simulated',
          sandbox: 'simulated',
        } as T;
      case 'browserNavigate': {
        const url = new URL(command.url);
        if (url.origin !== this.previewUrl)
          return { error: { code: 'navigation_denied', message: 'Destino fora da política de rede.', retryable: false }, decisions: [{ origin: url.origin, rule: 'default', allowed: false, code: 'not_allowed', count: 1 }] } as T;
        return { url: command.url, status: 200, ok: true, title: 'Prévia', preview: { previewId: this.previewTask, taskId: this.previewTask }, decisions: [{ origin: this.previewUrl, rule: 'preview', allowed: true, code: 'allowed', count: 1 }] } as T;
      }
      case 'browserSnapshot':
        return { snapshotId: 's1', url: this.previewUrl, text: this.page, elements: [] } as T;
      case 'browserScreenshot': {
        const png = Buffer.from('89504e470d0a1a0a', 'hex');
        return { artifact: { mediaType: 'image/png', encoding: 'base64', data: png.toString('base64'), bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') } } as T;
      }
      case 'browserDiagnostics':
        return { console: [], network: [], dropped: 0 } as T;
      case 'browserClick':
      case 'browserFill':
      case 'browserWait':
      case 'browserClose':
        return { ok: true } as T;
      case 'publicationEvents':
        return { ok: true, events: [], next: command.after ?? 0 } as T;
      default:
        throw Object.assign(new Error(`Ambiente simulado não oferece ${action}.`), { code: 'unsupported' });
    }
  }

  private view(job: Job | undefined) {
    if (!job) return undefined;
    const { child: _child, ...rest } = job;
    void _child;
    return rest;
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
    const job: Job = { id, type: 'check', state: 'running', log: '' };
    this.jobs.set(id, job);
    const child = spawn('bash', ['-lc', command.command], { cwd: join(this.worktree, command.cwd ?? '.') });
    job.child = child;
    child.stdout.on('data', (chunk) => (job.log += String(chunk)));
    child.stderr.on('data', (chunk) => (job.log += String(chunk)));
    child.on('close', (code, signal) => {
      void this.ops({ op: 'treeHash' }).then((after: { revision: string }) => {
        delete job.child;
        Object.assign(job, {
          state: 'succeeded',
          result: {
            kind: command.kind,
            exitCode: code,
            result: signal ? 'cancelled' : code === 0 ? 'passed' : code === 127 ? 'infrastructure' : 'failed',
            classification: code === 0 || code === 1 ? 'code' : 'environment',
            revisionBefore,
            revisionAfter: after.revision,
            stale: after.revision !== revisionBefore,
            outputTail: (job.log ?? '').slice(-4000),
          },
        });
      });
    });
    return { id, state: 'running' };
  }
}

/** Relative paths of files in a directory, for manifests. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === '.git') continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(dir, path));
    }
  };
  walk(dir);
  return out.sort();
}
