import { createHash } from 'node:crypto';
import { z } from 'zod';
import { GitRef, Id, type Project, type Saved, type Task } from '@oinko/workspaces/contracts';
import type { Environment, Job } from '@oinko/environments/contracts';
import type { RunnerConnection } from './service.js';

export const PrepareSchema = z.object({
  repositoryUrl: z
    .string()
    .min(1)
    .max(2000)
    .describe('URL raiz HTTPS do GitHub ou owner/repo, sem credenciais.'),
  ref: GitRef.optional().describe('Branch, tag ou commit; padrão HEAD em um projeto novo.'),
  projectId: Id.optional().describe(
    'Selecione explicitamente se o repositório estiver em mais de um projeto.',
  ),
  name: z.string().trim().min(1).max(100).optional(),
  environmentId: Id.optional().describe(
    'Ambiente existente a reutilizar; deve pertencer ao projeto, se já cadastrado.',
  ),
  branch: GitRef.default('task/sandbox'),
  taskName: z.string().trim().min(1).max(120).default('Preparar sandbox'),
});

function githubSource(value: string) {
  const raw = /^[\w.-]+\/[\w.-]+$/.test(value) ? `https://github.com/${value}` : value;
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)
  )
    throw new Error(
      'Informe a URL raiz do GitHub ou owner/repo, sem credenciais. Passe a branch no campo ref.',
    );
  const path = url.pathname.replace(/\/$/, '').replace(/\.git$/, '');
  return `https://github.com${path}.git`;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 10);
function matches(source: string, expected: string) {
  try {
    return githubSource(source).toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}

export async function prepareProject(
  client: RunnerConnection,
  input: z.infer<typeof PrepareSchema>,
) {
  const source = githubSource(input.repositoryUrl);
  const state = await client.state();
  const candidates = state.projects.filter((p) =>
    p.repositories.some((r) => matches(r.source, source)),
  );
  if (!input.projectId && candidates.length > 1)
    throw new Error('Este repositório pertence a vários projetos. Informe projectId.');
  let project = input.projectId
    ? state.projects.find((p) => p.id === input.projectId)
    : candidates[0];
  if (project) {
    const repos = project.repositories.filter((r) => matches(r.source, source));
    if (repos.length !== 1)
      throw new Error(
        'O projeto não identifica unicamente esse repositório. Use outro projectId ou oinko_configure_project.',
      );
    if (input.ref && input.ref !== repos[0]!.ref)
      throw new Error(
        'A referência solicitada difere da referência cadastrada. Preserve as tarefas existentes e escolha outro projeto.',
      );
    if (
      input.environmentId &&
      input.environmentId !== project.environmentId &&
      !project.environmentIds?.includes(input.environmentId)
    )
      throw new Error(
        'O ambiente solicitado não pertence ao projeto. Vincule-o com oinko_configure_project.',
      );
  }
  const repoName = source
    .split('/')
    .at(-1)!
    .replace(/\.git$/, '');
  const slug =
    repoName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '') || 'repo';
  const projectId =
    project?.id ?? input.projectId ?? `p-${slug.slice(0, 30)}-${hash(source.toLowerCase())}`;
  if (!project && state.projects.some((p) => p.id === projectId))
    throw new Error('ID de projeto já utilizado. Escolha outro projectId.');
  const environmentId =
    input.environmentId ?? project?.environmentId ?? `sandbox-${hash(projectId)}`;
  let environment = state.environments.find((e) => e.id === environmentId);
  if (!environment && input.environmentId)
    throw new Error('Ambiente inexistente. Configure-o antes de reutilizar.');
  if (!environment) {
    // A deterministic ID allows retry after a partial setup without replacing settings.
    environment = (await client.command({
      action: 'saveEnvironment',
      revision: 0,
      definition: { id: environmentId, name: `Sandbox ${repoName}`.slice(0, 100) },
    })) as Saved<Environment> & { secretNames: string[] };
  }
  if (!project || !project.environmentId) {
    project = (await client.command({
      action: 'saveProject',
      revision: project?.revision ?? 0,
      definition: project
        ? {
            ...project,
            environmentId,
            environmentIds: [...new Set([...(project.environmentIds ?? []), environmentId])],
          }
        : {
            id: projectId,
            name: input.name ?? repoName.slice(0, 100),
            environmentId,
            environmentIds: [environmentId],
            repositories: [{ id: 'app', source, ref: input.ref ?? 'HEAD' }],
            allowedBotIds: [],
          },
    })) as Saved<Project>;
  }
  let task = state.tasks.find((t) => t.projectId === projectId && t.branch === input.branch);
  let job: Job | undefined;
  if (!task || task.state === 'failed') {
    const definition = {
      id: task?.id ?? `task-${hash(`${projectId}/${input.branch}`)}`,
      projectId,
      name: input.taskName,
      branch: input.branch,
    };
    job = (await client.command({ action: 'createTask', definition })) as Job;
    task = {
      ...definition,
      state: 'creating',
      createdAt: job.createdAt,
      revision: task?.revision ?? 0,
    } as Saved<Task>;
  }
  return {
    project,
    environment,
    task,
    ...(job ? { job } : {}),
    next:
      task.state === 'ready'
        ? 'Inspecione a worktree com oinko_inspect_repository e configure os serviços antes de iniciar a prévia.'
        : job
          ? 'Acompanhe job.id com oinko_job. A tarefa ainda está sendo preparada.'
          : 'A tarefa já está sendo preparada. Acompanhe oinko_status.',
  };
}
