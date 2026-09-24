import type { Project, Saved, Task, WorkspaceStore } from '@oinko/workspaces';
import type { Job } from '../contracts/index.js';
import type { RunnerCommandValue, RunnerCorrelationValue } from '../contracts/requests.js';
import type { DockerSandbox } from '../sandbox/docker.js';
import type { EnvironmentStore } from '../storage/store.js';
import type { PreviewManager } from './previews.js';

/** What an extension may use from the runner for one request. */
export interface RunnerContext {
  readonly root: string;
  readonly workspaces: WorkspaceStore;
  readonly environments: EnvironmentStore;
  readonly sandbox: DockerSandbox;
  readonly previews: PreviewManager;
  /** Caller identity; undefined only for the installation administrator. */
  readonly botId?: string;
  readonly correlation?: RunnerCorrelationValue;
  /** Serializes work on one key (a project) across requests. */
  serial<T>(key: string, action: () => Promise<T>): Promise<T>;
  /** Persisted asynchronous job with a log; returns immediately. */
  enqueue(
    type: string,
    projectId: string,
    action: (log: (text: string) => void, job: Job) => Promise<unknown>,
    extra?: Partial<Job>,
  ): Job;
  redact(text: string): string;
  /** A ready task the caller may use, optionally checking the repository belongs to it. */
  task(taskId: string, repositoryId?: string): { project: Saved<Project>; task: Saved<Task> };
  /** Throws unless the caller is the installation administrator. */
  admin(): void;
}

/**
 * A group of runner commands owned by one capability (workspace, browser,
 * publication). The controller stays the single entry point and authority.
 */
export interface RunnerExtension {
  readonly actions: ReadonlySet<string>;
  handle(command: RunnerCommandValue, context: RunnerContext): Promise<unknown>;
  /** Called once at runner start, before accepting requests. */
  recover?(context: Omit<RunnerContext, 'botId' | 'correlation'>): Promise<void>;
  close?(): Promise<void>;
}
