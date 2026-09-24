import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkspaceStore, WorktreeManager, WorkspaceError, type Project } from '@oinko/workspaces';
import { RUNNER_ACTIONS, RunnerRequest, isBaseCommand, runnerHandles } from '../contracts/requests.js';
import type { Job } from '../contracts/index.js';
import { EnvironmentStore } from '../storage/store.js';
import { DockerSandbox } from '../sandbox/docker.js';
import { PreviewManager } from './previews.js';
import { runCommand } from './command.js';
import type { RunnerContext, RunnerExtension } from './extensions.js';
import type { RunnerCorrelationValue } from '../contracts/requests.js';
import { WorkspaceExtension } from '../workspace/extension.js';
import { BrowserExtension } from '../browser/extension.js';
import { PublicationExtension } from '../publication/extension.js';

/** Crash tests only: set by the test harness in the runner's own environment, never by callers. */
function faultInjection(): number | undefined {
  const value = process.env.OINKO_FAULT_EDIT_AFTER_WRITES;
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}

export class EnvironmentController {
  readonly workspaces: WorkspaceStore;
  readonly environments: EnvironmentStore;
  readonly sandbox: DockerSandbox;
  readonly previews: PreviewManager;
  private readonly queue = new Map<string, Promise<void>>();
  readonly extensions: RunnerExtension[];
  constructor(
    readonly root: string,
    options: { extensions?: RunnerExtension[] } = {},
  ) {
    this.workspaces = new WorkspaceStore(root);
    this.environments = new EnvironmentStore(root);
    this.sandbox = new DockerSandbox(root, (id) => this.environments.environment(id));
    this.previews = new PreviewManager(root, this.environments, this.sandbox);
    mkdirSync(join(root, '.harness/runtime/jobs'), { recursive: true, mode: 0o700 });
    this.extensions = options.extensions ?? [
      new WorkspaceExtension({ faultAfterWrites: faultInjection() }),
      new BrowserExtension(),
      new PublicationExtension(),
    ];
  }
  /** Shared runner facilities handed to extensions; authority stays here. */
  context(botId?: string, correlation?: RunnerCorrelationValue): RunnerContext {
    return {
      root: this.root,
      workspaces: this.workspaces,
      environments: this.environments,
      sandbox: this.sandbox,
      previews: this.previews,
      ...(botId !== undefined && { botId }),
      ...(correlation !== undefined && { correlation }),
      serial: (key, action) => this.serial(key, action),
      enqueue: (type, projectId, action, extra) => this.enqueue(type, projectId, action, extra),
      redact: (text) => this.redact(text),
      task: (taskId, repositoryId) => {
        const task = this.workspaces.task(taskId);
        const project = this.workspaces.authorize(task.projectId, botId);
        if (task.state !== 'ready') throw new WorkspaceError('A tarefa ainda não está pronta.');
        if (repositoryId !== undefined) this.repository(project, repositoryId);
        return { project, task };
      },
      admin: () => {
        if (botId) throw new WorkspaceError('Esta operação pertence ao administrador.');
      },
    };
  }
  async recover() {
    for (const job of this.environments.jobs())
      if (['running', 'queued'].includes(job.state))
        this.environments.saveJob({
          ...job,
          state: 'failed',
          // Unknown outcome, not a known failure: the process may have finished its effect.
          interrupted: true,
          error: 'Gerenciador reiniciado durante a operação. Verifique o estado e tente novamente.',
          finishedAt: new Date().toISOString(),
        });
    for (const task of this.workspaces.tasks())
      if (task.state === 'creating')
        this.workspaces.saveTask(
          {
            ...task,
            state: 'failed',
            error: 'Criação interrompida. Tente criar novamente com o mesmo ID.',
          },
          task.revision,
        );
    await this.previews.reconcile();
    for (const extension of this.extensions) await extension.recover?.(this.context());
  }
  redact(text: string) {
    return this.environments.redact(text);
  }
  private logsPath(id: string) {
    return join(this.root, '.harness/runtime/jobs', `${id}.log`);
  }
  private serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const current = (this.queue.get(key) ?? Promise.resolve()).then(action);
    const settled = current.then(
      () => {},
      () => {},
    );
    this.queue.set(key, settled);
    void settled.then(() => {
      if (this.queue.get(key) === settled) this.queue.delete(key);
    });
    return current;
  }
  private enqueue(
    type: string,
    projectId: string,
    action: (log: (text: string) => void, job: Job) => Promise<unknown>,
    extra: Partial<Job> = {},
  ) {
    const job: Job = {
      ...extra,
      id: `job-${randomUUID().slice(0, 12)}`,
      type,
      projectId,
      state: 'queued',
      createdAt: new Date().toISOString(),
    };
    this.environments.saveJob(job);
    let output = '';
    const log = (text: string) => {
      output = (output + text).slice(-1_000_000);
      writeFileSync(this.logsPath(job.id), this.redact(output), { mode: 0o600 });
    };
    void this.serial(projectId, async () => {
      this.environments.saveJob({ ...job, state: 'running' });
      try {
        const result = await action(log, job);
        this.environments.saveJob({
          ...job,
          state: 'succeeded',
          finishedAt: new Date().toISOString(),
          result,
        });
      } catch (error) {
        const message = this.redact(error instanceof Error ? error.message : 'Operação falhou.');
        log(`\n${message}\n`);
        this.environments.saveJob({
          ...job,
          state: 'failed',
          error: message,
          finishedAt: new Date().toISOString(),
        });
      }
    });
    return job;
  }
  /** Commands this runner handles: its own plus those of the registered extensions. */
  actions(): string[] {
    return RUNNER_ACTIONS.filter(
      (action) =>
        runnerHandles(undefined, action) || this.extensions.some((item) => item.actions.has(action)),
    );
  }
  async handle(input: unknown): Promise<unknown> {
    const { command, botId, correlation } = RunnerRequest.parse(input);
    const extension = this.extensions.find((item) => item.actions.has(command.action));
    if (extension) return extension.handle(command, this.context(botId, correlation));
    if (!isBaseCommand(command))
      throw new WorkspaceError('Esta operação não está disponível neste gerenciador.');
    const admin = () => {
      if (botId) throw new WorkspaceError('A configuração de ambientes pertence ao administrador.');
    };
    if (command.action === 'state') {
      const projects = this.workspaces
        .projects()
        .filter((project) => !botId || project.allowedBotIds.includes(botId));
      const projectIds = new Set(projects.map((project) => project.id));
      return {
        pid: process.pid,
        projects,
        environments: this.environments
          .environments()
          .filter(
            (environment) =>
              !botId ||
              projects.some(
                (project) =>
                  project.environmentId === environment.id ||
                  project.environmentIds?.includes(environment.id),
              ),
          ),
        tasks: this.workspaces.tasks().filter((task) => projectIds.has(task.projectId)),
        previews: this.environments
          .previews()
          .filter((preview) => projectIds.has(preview.projectId)),
        jobs: this.environments
          .jobs()
          .filter((job) => !job.projectId || projectIds.has(job.projectId))
          .slice(0, 100),
        sandboxes: Object.fromEntries(
          await Promise.all(
            projects.map(async (project) => [
              project.id,
              await this.sandbox.status(project.id).catch(() => 'unavailable'),
            ]),
          ),
        ),
        ...(!botId ? { settings: this.environments.settings() } : {}),
      };
    }
    if (command.action === 'saveEnvironment') {
      admin();
      return this.environments.saveEnvironment(
        command.definition,
        command.secrets,
        command.revision,
      );
    }
    if (command.action === 'saveProject') {
      admin();
      for (const id of [
        command.definition.environmentId,
        ...(command.definition.environmentIds ?? []),
      ].filter((id): id is string => !!id))
        this.environments.environment(id);
      const previous = this.workspaces
        .projects()
        .find((project) => project.id === command.definition.id);
      if (
        previous &&
        this.workspaces.tasks(previous.id).length &&
        JSON.stringify(previous.repositories) !== JSON.stringify(command.definition.repositories)
      )
        throw new WorkspaceError(
          'Crie outro projeto para alterar as origens Git depois de criar tarefas.',
        );
      return this.workspaces.saveProject(command.definition, command.revision);
    }
    if (command.action === 'saveSettings') {
      admin();
      if (
        this.environments
          .previews()
          .some((preview) => ['building', 'starting', 'ready'].includes(preview.state))
      )
        throw new WorkspaceError('Pare as prévias antes de alterar o acesso de rede.');
      await runCommand('docker', ['rm', '-f', this.previews.router.name], { allowFailure: true });
      return this.environments.saveSettings(command.definition, command.revision);
    }
    if (command.action === 'jobLogs') {
      const job = this.environments.job(command.jobId);
      if (job.projectId) this.workspaces.authorize(job.projectId, botId);
      return {
        text: existsSync(this.logsPath(job.id))
          ? this.redact(readFileSync(this.logsPath(job.id), 'utf8')).slice(-100_000)
          : '',
      };
    }
    if (command.action === 'previewLogs' || command.action === 'stopPreview') {
      const preview = this.environments.preview(command.previewId);
      this.workspaces.authorize(preview.projectId, botId);
      return command.action === 'previewLogs'
        ? { text: await this.previews.logs(preview.id) }
        : this.enqueue('stopPreview', preview.projectId, () => this.previews.stop(preview.id));
    }
    if (command.action === 'startSandbox' || command.action === 'stopSandbox') {
      const project = this.workspaces.authorize(command.projectId, botId);
      return this.enqueue(command.action, project.id, () =>
        command.action === 'startSandbox'
          ? this.sandbox.ensure(project)
          : this.sandbox.stop(project.id),
      );
    }
    if (command.action === 'createTask') {
      const project = this.workspaces.authorize(command.definition.projectId, botId);
      const previous = this.workspaces.tasks().find((task) => task.id === command.definition.id);
      if (
        previous &&
        (previous.projectId !== project.id ||
          previous.branch !== command.definition.branch ||
          previous.state !== 'failed')
      )
        throw new WorkspaceError('ID de tarefa já utilizado.');
      const task = this.workspaces.saveTask(
        { ...command.definition, state: 'creating' },
        previous?.revision ?? 0,
      );
      return this.enqueue('createTask', project.id, async (log) => {
        try {
          const sandbox = new DockerSandbox(
            this.root,
            (id) => this.environments.environment(id),
            runCommand,
            log,
          );
          await sandbox.ensure(project);
          await new WorktreeManager(sandbox).create(project, task);
          return this.workspaces.saveTask(
            { ...task, state: 'ready', error: undefined },
            task.revision,
          );
        } catch (error) {
          this.workspaces.saveTask(
            {
              ...task,
              state: 'failed',
              error: this.redact(error instanceof Error ? error.message : 'Criação falhou.'),
            },
            task.revision,
          );
          throw error;
        }
      });
    }
    const task = this.workspaces.task(command.taskId);
    const project = this.workspaces.authorize(task.projectId, botId);
    if (task.state !== 'ready') throw new WorkspaceError('A tarefa ainda não está pronta.');
    if (command.action === 'startPreview') {
      const environmentId = command.environmentId ?? project.environmentId;
      if (
        !environmentId ||
        (environmentId !== project.environmentId &&
          !project.environmentIds?.includes(environmentId))
      )
        throw new WorkspaceError('O ambiente não pertence a este projeto.');
      return this.enqueue('startPreview', project.id, (log) =>
        this.previews.start(project, task, log, environmentId),
      );
    }
    this.repository(project, command.repositoryId);
    return this.serial(project.id, async () => {
      if (command.action === 'shell')
        return this.sandbox.shell(
          project,
          task.id,
          command.repositoryId,
          command.command,
          command.timeoutSeconds,
        );
      const script = `const fs=require('node:fs'),path=require('node:path');let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{const v=JSON.parse(input),root=fs.realpathSync(process.cwd()),p=path.resolve(root,v.path);const inside=x=>x===root||x.startsWith(root+path.sep);if(!inside(p))throw Error('Caminho fora da worktree');if(v.action==='writeFile'){const parts=path.relative(root,path.dirname(p)).split(path.sep).filter(Boolean);let parent=root;for(const part of parts){parent=path.join(parent,part);if(!fs.existsSync(parent))fs.mkdirSync(parent);if(!inside(fs.realpathSync(parent)))throw Error('Symlink fora da worktree');}if(fs.lstatSync(p,{throwIfNoEntry:false})){let real;try{real=fs.realpathSync(p);}catch{throw Error('Symlink fora da worktree ou destino ausente');}if(!inside(real))throw Error('Symlink fora da worktree');}fs.writeFileSync(p,v.content);console.log('Arquivo salvo');}else{if(!inside(fs.realpathSync(p)))throw Error('Symlink fora da worktree');const fd=fs.openSync(p,'r');try{const b=Buffer.alloc(200001),n=fs.readSync(fd,b,0,b.length,0);if(n>200000)throw Error('Arquivo excede 200 KB');process.stdout.write(b.subarray(0,n));}finally{fs.closeSync(fd);}}});`;
      const result = await this.sandbox.exec(
        project,
        ['node', '-e', script],
        `/workspace/tasks/${task.id}/${command.repositoryId}`,
        { input: JSON.stringify(command), timeoutMs: 30_000 },
      );
      return { text: result.stdout };
    });
  }
  private repository(project: Project, id: string) {
    if (!project.repositories.some((repo) => repo.id === id))
      throw new WorkspaceError('Repositório não pertence ao projeto.');
  }
  async drain() {
    await Promise.all([...this.queue.values()]);
  }
  close() {
    for (const extension of this.extensions) void extension.close?.();
    this.workspaces.close();
    this.environments.close();
  }
}
