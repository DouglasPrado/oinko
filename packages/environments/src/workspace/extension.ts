import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WorkspaceError, type Project, type Task } from '@oinko/workspaces';
import type { Job } from '../contracts/index.js';
import type { RunnerCommandValue } from '../contracts/requests.js';
import type { WorkspaceCommandValue, WorkspaceEdit } from '../contracts/workspace-requests.js';
import type { RunnerContext, RunnerExtension } from '../runtime/extensions.js';
import { WORKSPACE_OPS_SCRIPT } from './ops.js';

type Command<A extends string> = Extract<RunnerCommandValue, { action: A }>;
type Ops = Record<string, unknown> & { op: string };

/** How ops reach the worktree: the sandbox container in production. */
export interface OpsTransport {
  run(project: Project, task: Task, repositoryId: string, request: Ops, timeoutMs?: number): Promise<Record<string, unknown>>;
}

export function sandboxTransport(context: Pick<RunnerContext, 'sandbox'>): OpsTransport {
  return {
    async run(project, task, repositoryId, request, timeoutMs = 60_000) {
      const result = await context.sandbox.exec(
        project,
        ['node', '-e', WORKSPACE_OPS_SCRIPT],
        `/workspace/tasks/${task.id}/${repositoryId}`,
        { input: JSON.stringify(request), timeoutMs, allowFailure: true },
      );
      try {
        return JSON.parse(result.stdout) as Record<string, unknown>;
      } catch {
        throw new WorkspaceError(
          `Operação no sandbox não retornou resultado (código ${result.exitCode}). ${result.stderr.slice(-500)}`,
        );
      }
    },
  };
}

/** Structured error: `code` lets callers tell conflicts from failures. */
export class WorkspaceOpError extends WorkspaceError {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function unwrap(result: Record<string, unknown>): Record<string, unknown> {
  const error = result.error as { code?: string; message?: string; details?: Record<string, unknown> } | undefined;
  if (error) throw new WorkspaceOpError(error.code ?? 'ops_failed', error.message ?? 'Operação falhou.', error.details);
  return result;
}

interface EditJournal {
  operationId: string;
  botId?: string;
  projectId: string;
  taskId: string;
  repositoryId: string;
  editsHash: string;
  state: 'applying' | 'applied';
  files: { path: string; beforeHash: string; afterHash: string }[];
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface CheckRecord {
  jobId: string;
  projectId: string;
  taskId: string;
  repositoryId: string;
  kind: string;
  command: string;
  cwd: string;
  deadline: number;
  startedAt: number;
  revisionBefore?: string;
}

const INFRASTRUCTURE =
  /command not found|ENOENT|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ECONNREFUSED|getaddrinfo|network (error|timeout)|No space left on device|out of memory|Cannot allocate memory|ERR_PNPM_FETCH|npm ERR! network|Temporary failure in name resolution/i;

/**
 * Workspace capability of the runner. Reads never serialize; edits serialize
 * per project and are journaled on the host before any write, so a crash
 * mid-patch is reconciled by content hashes instead of being repeated.
 */
export class WorkspaceExtension implements RunnerExtension {
  readonly actions: ReadonlySet<string> = new Set([
    'searchPaths',
    'searchContent',
    'readRange',
    'replaceExact',
    'applyPatch',
    'reconcileEdit',
    'gitSnapshot',
    'gitDiff',
    'projectContext',
    'startCheck',
    'inspectJob',
    'stopJob',
  ]);
  private readonly watchers = new Map<string, Promise<void>>();
  private readonly stopping = new Set<string>();

  constructor(
    private readonly options: {
      transport?: (context: RunnerContext) => OpsTransport;
      /** Crash-test hook, never controllable by callers. */
      faultAfterWrites?: number;
      pollMs?: number;
    } = {},
  ) {}

  private transport(context: RunnerContext): OpsTransport {
    return this.options.transport?.(context) ?? sandboxTransport(context);
  }

  async handle(input: RunnerCommandValue, context: RunnerContext): Promise<unknown> {
    if (!this.actions.has(input.action)) throw new WorkspaceError('Operação de workspace desconhecida.');
    const command = input as WorkspaceCommandValue;
    switch (command.action) {
      case 'inspectJob':
        return this.inspectJob(command, context);
      case 'stopJob':
        return this.stopJob(command, context);
    }
    if (!('taskId' in command)) throw new WorkspaceError('Operação de workspace inválida.');
    const { project, task } = context.task(command.taskId, command.repositoryId);
    const ops = (request: Ops, timeoutMs?: number) =>
      this.transport(context).run(project, task, command.repositoryId, request, timeoutMs).then(unwrap);
    switch (command.action) {
      case 'searchPaths':
      case 'searchContent': {
        const { action, taskId: _t, repositoryId: _r, ...rest } = command;
        void _t;
        void _r;
        return ops({ op: action, ...rest }, 30_000);
      }
      case 'readRange': {
        const { action, taskId: _t, repositoryId: _r, ...rest } = command;
        void _t;
        void _r;
        return ops({ op: action, ...rest });
      }
      case 'gitSnapshot': {
        if (!command.saveAs) return ops({ op: 'gitSnapshot' });
        const path = this.baselinePath(context, command.saveAs, task.id, command.repositoryId);
        if (existsSync(path)) return { ...(JSON.parse(readFileSync(path, 'utf8')) as object), saved: false };
        const snapshot = await ops({ op: 'gitSnapshot' });
        writeFileSync(path, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
        return { ...snapshot, saved: true };
      }
      case 'gitDiff': {
        let baseline = command.baseline;
        if (command.baselineRef) {
          const path = this.baselinePath(context, command.baselineRef, task.id, command.repositoryId);
          if (existsSync(path)) {
            const saved = JSON.parse(readFileSync(path, 'utf8')) as { headSha: string; files: Record<string, string> };
            baseline = { headSha: saved.headSha, files: saved.files };
          }
        }
        return ops({ op: 'gitDiff', baseline, maxPatchBytes: command.maxPatchBytes }, 120_000);
      }
      case 'projectContext':
        return ops({
          op: 'projectContext',
          targets: command.targets,
          overrides: (project.programming?.commands ?? []).filter((entry) => entry.repositoryId === command.repositoryId),
        });
      case 'replaceExact':
        return this.applyPatch(context, project, task, command.repositoryId, command.operationId, [
          {
            action: 'replace',
            path: command.path,
            expectedHash: command.expectedHash,
            oldText: command.oldText,
            newText: command.newText,
            replaceAll: command.replaceAll,
          },
        ]);
      case 'applyPatch':
        return this.applyPatch(context, project, task, command.repositoryId, command.operationId, command.edits);
      case 'reconcileEdit':
        return this.reconcileEdit(context, project, task, command.repositoryId, command.operationId);
      case 'startCheck':
        return this.startCheck(context, project, task, command);
      default:
        throw new WorkspaceError('Operação de workspace desconhecida.');
    }
  }

  // ---- edits --------------------------------------------------------------

  private baselinePath(context: Pick<RunnerContext, 'root' | 'botId'>, key: string, taskId: string, repositoryId: string) {
    const directory = join(context.root, '.harness/runtime/baselines');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const name = createHash('sha256').update(JSON.stringify([context.botId ?? '', key, taskId, repositoryId])).digest('hex').slice(0, 32);
    return join(directory, `${name}.json`);
  }

  private journalPath(context: Pick<RunnerContext, 'root'>, operationId: string) {
    const directory = join(context.root, '.harness/runtime/edits');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return join(directory, `${createHash('sha256').update(operationId).digest('hex').slice(0, 32)}.json`);
  }
  private readJournal(context: Pick<RunnerContext, 'root'>, operationId: string): EditJournal | undefined {
    const path = this.journalPath(context, operationId);
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as EditJournal) : undefined;
  }
  private writeJournal(context: Pick<RunnerContext, 'root'>, journal: EditJournal) {
    const path = this.journalPath(context, journal.operationId);
    writeFileSync(`${path}.tmp`, JSON.stringify(journal), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
    chmodSync(path, 0o600);
  }

  private async applyPatch(
    context: RunnerContext,
    project: Project,
    task: Task,
    repositoryId: string,
    operationId: string,
    edits: WorkspaceEdit[],
  ) {
    const transport = this.transport(context);
    const ops = (request: Ops) => transport.run(project, task, repositoryId, request).then(unwrap);
    const editsHash = createHash('sha256').update(JSON.stringify(edits)).digest('hex');
    return context.serial(project.id, async () => {
      const existing = this.readJournal(context, operationId);
      if (existing) {
        if (existing.editsHash !== editsHash || existing.taskId !== task.id || existing.repositoryId !== repositoryId)
          throw new WorkspaceOpError('idempotency_conflict', 'O mesmo operationId foi usado com outro patch.');
        if (existing.botId !== context.botId) throw new WorkspaceOpError('not_found', 'Operação não encontrada.');
        if (existing.state === 'applied') return { ...existing.result, replayed: true };
        // Interrupted earlier: finish only files still at their original content.
        const state = await this.classify(context, project, task, repositoryId, existing);
        if (state.conflicted.length)
          throw new WorkspaceOpError(
            'external_change',
            'Arquivos foram alterados por outra pessoa durante a recuperação; nada foi sobrescrito.',
            state,
          );
        const result = unwrap(
          await transport.run(project, task, repositoryId, {
            op: 'applyEdits',
            edits: edits.filter((edit) => state.pending.includes(edit.path)),
          }),
        );
        return this.finishJournal(context, existing, state.applied, result);
      }
      const plan = await ops({ op: 'planEdits', edits });
      if (!plan.ok)
        throw new WorkspaceOpError('edit_conflict', 'Nenhum arquivo foi alterado: pré-condições falharam.', {
          files: (plan.files as { ok: boolean }[]).filter((file) => !file.ok),
        });
      // Intent on the host before any write: the recovery knows what to expect.
      const journal: EditJournal = {
        operationId,
        ...(context.botId !== undefined && { botId: context.botId }),
        projectId: project.id,
        taskId: task.id,
        repositoryId,
        editsHash,
        state: 'applying',
        files: (plan.files as EditJournal['files']).map((file) => ({
          path: file.path,
          beforeHash: file.beforeHash,
          afterHash: file.afterHash,
        })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.writeJournal(context, journal);
      const result = unwrap(
        await transport.run(project, task, repositoryId, {
          op: 'applyEdits',
          edits,
          ...(this.options.faultAfterWrites !== undefined && { faultAfterWrites: this.options.faultAfterWrites, faultMode: 'throw' }),
        }),
      );
      return this.finishJournal(context, journal, [], result);
    });
  }

  private finishJournal(context: RunnerContext, journal: EditJournal, alreadyApplied: string[], result: Record<string, unknown>) {
    const applied = [...alreadyApplied, ...((result.applied as { path: string }[]) ?? []).map((file) => file.path)];
    const final = {
      ok: true,
      operationId: journal.operationId,
      files: journal.files,
      applied,
      revision: result.revision,
    };
    this.writeJournal(context, { ...journal, state: 'applied', result: final, updatedAt: new Date().toISOString() });
    return final;
  }

  private async classify(context: RunnerContext, project: Project, task: Task, repositoryId: string, journal: EditJournal) {
    const { hashes } = unwrap(
      await this.transport(context).run(project, task, repositoryId, { op: 'hashes', paths: journal.files.map((file) => file.path) }),
    ) as { hashes: Record<string, string> };
    const applied: string[] = [];
    const pending: string[] = [];
    const conflicted: string[] = [];
    for (const file of journal.files) {
      const current = hashes[file.path];
      if (current === file.afterHash) applied.push(file.path);
      else if (current === file.beforeHash) pending.push(file.path);
      else conflicted.push(file.path);
    }
    return { applied, pending, conflicted };
  }

  private async reconcileEdit(context: RunnerContext, project: Project, task: Task, repositoryId: string, operationId: string) {
    const journal = this.readJournal(context, operationId);
    if (!journal || journal.taskId !== task.id || journal.repositoryId !== repositoryId || journal.botId !== context.botId)
      return { found: false, state: 'unknown' as const };
    if (journal.state === 'applied') return { found: true, state: 'applied' as const, result: journal.result };
    const state = await this.classify(context, project, task, repositoryId, journal);
    return {
      found: true,
      state: state.conflicted.length ? ('conflicted' as const) : state.pending.length ? ('partial' as const) : ('applied' as const),
      ...state,
    };
  }

  // ---- checks -------------------------------------------------------------

  private jobDirectory(context: Pick<RunnerContext, 'sandbox'>, projectId: string) {
    return join(context.sandbox.path(projectId), 'home/.oinko/jobs');
  }

  private startCheck(context: RunnerContext, project: Project, task: Task, command: Command<'startCheck'>): Job {
    const job: Job = {
      id: `job-${randomUUID().slice(0, 12)}`,
      type: 'check',
      projectId: project.id,
      taskId: task.id,
      repositoryId: command.repositoryId,
      operationId: command.operationId,
      ...(context.botId !== undefined && { botId: context.botId }),
      state: 'running',
      createdAt: new Date().toISOString(),
    };
    context.environments.saveJob(job);
    const record: CheckRecord = {
      jobId: job.id,
      projectId: project.id,
      taskId: task.id,
      repositoryId: command.repositoryId,
      kind: command.kind,
      command: command.command,
      cwd: command.cwd,
      deadline: Date.now() + command.timeoutSeconds * 1000,
      startedAt: Date.now(),
    };
    const directory = this.jobDirectory(context, project.id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const watcher = (async () => {
      try {
        record.revisionBefore = await this.revision(context, project, task, command.repositoryId);
        writeFileSync(join(directory, `${job.id}.json`), JSON.stringify(record), { mode: 0o600 });
        await context.sandbox.ensure(project);
        const base = `/workspace/home/.oinko/jobs/${job.id}`;
        // setsid: the check is its own process group, so stop reaches every child.
        // Paths and command travel as environment values, never spliced into the script.
        // The command gets its own process group (setsid), separate from this
        // wrapper, so stopping it cannot kill the wrapper that records the exit.
        const wrapper = `cd "$OINKO_CHECK_CWD" || { echo 126 > ${base}.exit; exit 0; }; setsid bash -lc "$OINKO_CHECK_COMMAND" > ${base}.out 2>&1 & child=$!; echo $child > ${base}.pid; wait $child; code=$?; echo $code > ${base}.exit.tmp; mv ${base}.exit.tmp ${base}.exit`;
        await context.sandbox.run('docker', [
          'exec',
          '-d',
          '--env',
          `OINKO_CHECK_COMMAND=${command.command}`,
          '--env',
          `OINKO_CHECK_CWD=/workspace/tasks/${task.id}/${command.repositoryId}/${command.cwd}`,
          context.sandbox.name(project.id),
          'bash',
          '-c',
          wrapper,
        ]);
        await this.watch(context, project, task, record);
      } catch (error) {
        this.finishJob(context, job.id, {
          state: 'failed',
          error: context.redact(error instanceof Error ? error.message : 'Falha ao iniciar a verificação.'),
          result: { kind: command.kind, result: 'infrastructure', classification: 'environment' },
        });
      }
    })();
    this.watchers.set(job.id, watcher);
    void watcher.finally(() => this.watchers.delete(job.id));
    return job;
  }

  private async revision(context: RunnerContext, project: Project, task: Task, repositoryId: string): Promise<string> {
    const result = unwrap(await this.transport(context).run(project, task, repositoryId, { op: 'treeHash' }, 120_000));
    return String(result.revision);
  }

  /** Follows a detached check through its pid/exit files; also used to reattach after restart. */
  private async watch(context: RunnerContext, project: Project, task: Task, record: CheckRecord): Promise<void> {
    const directory = this.jobDirectory(context, project.id);
    const file = (suffix: string) => join(directory, `${record.jobId}.${suffix}`);
    let timedOut = false;
    let signalledAt: number | undefined;
    for (;;) {
      if (existsSync(file('exit'))) break;
      if (!timedOut && Date.now() > record.deadline) {
        timedOut = true;
        signalledAt = Date.now();
        await this.terminate(context, project, record.jobId, 5);
      }
      if (this.stopping.has(record.jobId)) signalledAt ??= Date.now();
      // Signalled and gone without an exit record (e.g. the wrapper was killed too):
      // stop waiting, the outcome is timeout/cancelled with an unknown code.
      if (signalledAt !== undefined && Date.now() - signalledAt > 10_000 && !(await this.alive(context, project.id, record.jobId)))
        break;
      this.copyLog(context, record.jobId, file('out'));
      await delay(this.options.pollMs ?? 250);
    }
    this.copyLog(context, record.jobId, file('out'));
    const exitCode = existsSync(file('exit')) ? Number.parseInt(readFileSync(file('exit'), 'utf8').trim(), 10) : null;
    const output = existsSync(file('out')) ? context.redact(readFileSync(file('out'), 'utf8')) : '';
    const revisionAfter = await this.revision(context, project, task, record.repositoryId).catch(() => undefined);
    const cancelled = this.stopping.has(record.jobId) || context.environments.job(record.jobId).cancelled === true;
    const result = cancelled
      ? 'cancelled'
      : timedOut
        ? 'timeout'
        : exitCode === 0
          ? 'passed'
          : exitCode === null || exitCode === 127 || exitCode === 137 || INFRASTRUCTURE.test(output.slice(-20_000))
            ? 'infrastructure'
            : 'failed';
    this.finishJob(context, record.jobId, {
      state: 'succeeded',
      result: {
        kind: record.kind,
        command: record.command,
        cwd: record.cwd,
        exitCode,
        result,
        classification: result === 'passed' || result === 'failed' ? 'code' : result === 'cancelled' ? 'cancelled' : 'environment',
        revisionBefore: record.revisionBefore,
        revisionAfter,
        stale: revisionAfter !== undefined && revisionAfter !== record.revisionBefore,
        durationMs: Date.now() - record.startedAt,
        outputTail: output.slice(-4000),
        outputBytes: Buffer.byteLength(output),
      },
      ...(cancelled && { cancelled: true }),
    });
  }

  private copyLog(context: RunnerContext, jobId: string, source: string) {
    if (!existsSync(source)) return;
    const logs = join(context.root, '.harness/runtime/jobs');
    mkdirSync(logs, { recursive: true, mode: 0o700 });
    writeFileSync(join(logs, `${jobId}.log`), context.redact(readFileSync(source, 'utf8').slice(-1_000_000)), { mode: 0o600 });
  }

  private finishJob(context: RunnerContext, jobId: string, patch: Partial<Job>) {
    const current = context.environments.job(jobId);
    context.environments.saveJob({
      ...current,
      ...patch,
      interrupted: patch.interrupted ?? false,
      finishedAt: new Date().toISOString(),
    });
  }

  /** TERM to the whole process group, then KILL after the grace period. */
  private async terminate(context: RunnerContext, project: Project, jobId: string, graceSeconds: number): Promise<boolean> {
    const pidFile = join(this.jobDirectory(context, project.id), `${jobId}.pid`);
    const exitFile = join(this.jobDirectory(context, project.id), `${jobId}.exit`);
    if (!existsSync(pidFile)) return false;
    const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    if (!Number.isInteger(pid) || pid <= 1) return false;
    const kill = (signal: string) =>
      context.sandbox.run('docker', ['exec', context.sandbox.name(project.id), 'kill', `-${signal}`, '--', `-${pid}`], { allowFailure: true });
    await kill('TERM');
    const deadline = Date.now() + graceSeconds * 1000;
    while (Date.now() < deadline && !existsSync(exitFile)) await delay(100);
    const escalated = !existsSync(exitFile);
    if (escalated) await kill('KILL');
    return escalated;
  }

  private authorizeJob(context: RunnerContext, jobId: string): Job {
    const job = context.environments.job(jobId);
    if (job.projectId) context.workspaces.authorize(job.projectId, context.botId);
    if (context.botId && job.botId && job.botId !== context.botId) throw new WorkspaceError('Operação não encontrada.');
    return job;
  }

  private inspectJob(command: Command<'inspectJob'>, context: RunnerContext) {
    const job = this.authorizeJob(context, command.jobId);
    const log = join(context.root, '.harness/runtime/jobs', `${job.id}.log`);
    return { job, tail: existsSync(log) ? context.redact(readFileSync(log, 'utf8')).slice(-4000) : '' };
  }

  private async stopJob(command: Command<'stopJob'>, context: RunnerContext) {
    const job = this.authorizeJob(context, command.jobId);
    if (job.type !== 'check') throw new WorkspaceError('Somente verificações podem ser paradas por esta operação.');
    if (job.state !== 'running') return { job, stopped: false, reason: 'not_running' };
    this.stopping.add(job.id);
    const project = context.workspaces.project(job.projectId!);
    context.environments.saveJob({ ...job, cancelled: true });
    const escalated = await this.terminate(context, project, job.id, command.graceSeconds);
    await this.watchers.get(job.id);
    this.stopping.delete(job.id);
    return { job: context.environments.job(job.id), stopped: true, escalated };
  }

  /**
   * After a runner restart the controller marked running jobs `interrupted`.
   * A check whose process finished meanwhile gets its real result; one still
   * running is reattached; one without trace stays interrupted (unknown).
   */
  async recover(context: Omit<RunnerContext, 'botId' | 'correlation'>): Promise<void> {
    for (const job of context.environments.jobs()) {
      if (job.type !== 'check' || !job.interrupted || !job.projectId || !job.taskId || !job.repositoryId) continue;
      const directory = this.jobDirectory(context, job.projectId);
      const recordFile = join(directory, `${job.id}.json`);
      if (!existsSync(recordFile)) continue;
      const record = JSON.parse(readFileSync(recordFile, 'utf8')) as CheckRecord;
      const exited = existsSync(join(directory, `${job.id}.exit`));
      const running = !exited && (await this.alive(context, job.projectId, job.id));
      if (!exited && !running) continue;
      const project = context.workspaces.project(job.projectId);
      const task = context.workspaces.task(job.taskId);
      context.environments.saveJob({ ...job, state: 'running', interrupted: false, error: undefined, finishedAt: undefined });
      const full = context as RunnerContext;
      const watcher = this.watch(full, project, task, record).catch((error: unknown) =>
        this.finishJob(full, job.id, {
          state: 'failed',
          interrupted: true,
          error: error instanceof Error ? error.message : 'Falha ao reanexar a verificação.',
        }),
      );
      this.watchers.set(job.id, watcher);
      void watcher.finally(() => this.watchers.delete(job.id));
    }
  }

  private async alive(context: Pick<RunnerContext, 'sandbox'>, projectId: string, jobId: string): Promise<boolean> {
    const pidFile = join(this.jobDirectory(context, projectId), `${jobId}.pid`);
    if (!existsSync(pidFile)) return false;
    const pid = readFileSync(pidFile, 'utf8').trim();
    const result = await context.sandbox.run('docker', ['exec', context.sandbox.name(projectId), 'kill', '-0', pid], { allowFailure: true });
    return result.exitCode === 0;
  }

  async close(): Promise<void> {
    // Detached checks keep running in the sandbox; the next runner reattaches.
    this.watchers.clear();
  }

  /** Test helper: removes a finished job's sandbox files. */
  cleanupJob(context: Pick<RunnerContext, 'sandbox'>, projectId: string, jobId: string) {
    for (const suffix of ['pid', 'out', 'exit', 'json']) rmSync(join(this.jobDirectory(context, projectId), `${jobId}.${suffix}`), { force: true });
  }
}
