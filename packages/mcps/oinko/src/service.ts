import { setTimeout as delay } from 'node:timers/promises';
import type { RunnerCommandInput, RunnerState } from '@oinko/environments/client';
import type { CommandResult } from '@oinko/environments/contracts';
import { INSPECT_COMMAND } from './inspect.js';

export interface RunnerConnection {
  state(): Promise<RunnerState>;
  command(input: RunnerCommandInput): Promise<unknown>;
}
export async function status(client: RunnerConnection, projectId?: string) {
  const state = await client.state();
  if (!projectId) return state;
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) throw new Error('Projeto inexistente. Consulte oinko_status sem filtro.');
  const environments = new Set([project.environmentId, ...(project.environmentIds ?? [])]);
  return {
    ...state,
    projects: [project],
    environments: state.environments.filter((e) => environments.has(e.id)),
    tasks: state.tasks.filter((t) => t.projectId === projectId),
    previews: state.previews.filter((p) => p.projectId === projectId),
    jobs: state.jobs.filter((j) => j.projectId === projectId),
    sandboxes: { [projectId]: state.sandboxes[projectId] },
  };
}
export async function waitJob(
  client: RunnerConnection,
  jobId: string,
  seconds: number,
  signal?: AbortSignal,
) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    signal?.throwIfAborted();
    const state = await client.state();
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job)
      throw new Error(
        'Job não encontrado entre as 100 operações recentes. Consulte oinko_status ou seus logs por ID.',
      );
    if (!['queued', 'running'].includes(job.state) || Date.now() >= deadline)
      return {
        job,
        previews: state.previews.filter((p) => p.projectId === job.projectId),
        next: ['queued', 'running'].includes(job.state)
          ? 'Operação em andamento. Consulte novamente oinko_job.'
          : undefined,
      };
    await delay(Math.min(500, deadline - Date.now()), undefined, { signal });
  }
}
export async function logs(
  client: RunnerConnection,
  kind: 'job' | 'preview',
  id: string,
  tailChars: number,
) {
  const result = (await client.command(
    kind === 'job' ? { action: 'jobLogs', jobId: id } : { action: 'previewLogs', previewId: id },
  )) as { text: string };
  return { text: result.text.slice(-tailChars), truncated: result.text.length > tailChars };
}
export async function inspect(client: RunnerConnection, taskId: string, repositoryId: string) {
  const result = (await client.command({
    action: 'shell',
    taskId,
    repositoryId,
    command: INSPECT_COMMAND,
    timeoutSeconds: 30,
  })) as CommandResult;
  if (result.exitCode !== 0) throw new Error(`Não foi possível inspecionar: ${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}
