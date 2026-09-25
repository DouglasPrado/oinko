import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WorkspaceError, type Project, type Task } from '@oinko/workspaces';
import { type CommandRunner, type Preview } from '../contracts/index.js';
import { EnvironmentStore } from '../storage/store.js';
import { DockerSandbox } from '../sandbox/docker.js';
import { TraefikRouter } from '../routing/traefik.js';
import { prepareCompose } from './compose.js';
import { runCommand } from './command.js';

export class PreviewManager {
  readonly router: TraefikRouter;
  constructor(
    readonly root: string,
    readonly store: EnvironmentStore,
    readonly sandbox: DockerSandbox,
    private readonly run: CommandRunner = runCommand,
  ) {
    this.router = new TraefikRouter(root, sandbox.namespace, run);
  }
  async start(
    project: Project,
    task: Task,
    onOutput?: (text: string) => void,
    environmentId = project.environmentId,
  ) {
    if (task.state !== 'ready' || task.projectId !== project.id)
      throw new WorkspaceError('Selecione uma tarefa pronta deste projeto.');
    if (
      !environmentId ||
      (environmentId !== project.environmentId && !project.environmentIds?.includes(environmentId))
    )
      throw new WorkspaceError('O ambiente não pertence a este projeto.');
    const env = this.store.environment(environmentId);
    // Preserve resource identity even when the project's default environment changes.
    const existing = this.store.previews();
    const id =
      existing.find(
        (preview) =>
          preview.taskId === task.id &&
          preview.projectId === project.id &&
          preview.environmentId === env.id,
      )?.id ??
      (environmentId === project.environmentId &&
      !existing.some((preview) => preview.id === task.id)
        ? task.id
        : `p-${createHash('sha256').update(`${project.id}/${task.id}/${environmentId}`).digest('hex').slice(0, 24)}`);
    if (this.store.previews().some((preview) => preview.id === id && preview.state !== 'stopped'))
      await this.stop(id);
    const previous = this.store
      .previews()
      .filter(
        (preview) =>
          preview.projectId === project.id &&
          preview.environmentId === env.id &&
          preview.id !== id &&
          ['ready', 'building', 'starting', 'failed'].includes(preview.state),
      );
    while (previous.length >= env.maxPreviews) await this.stop(previous.shift()!.id);
    const preview: Preview = {
      id,
      projectId: project.id,
      taskId: task.id,
      environmentId: env.id,
      state: 'building',
      createdAt: new Date().toISOString(),
      urls: [],
    };
    this.store.savePreview(preview);
    try {
      const prepared = await prepareCompose({
        root: this.root,
        workspace: this.sandbox.path(project.id),
        environment: env,
        task,
        name: `${this.sandbox.namespace}-p-${id}`,
        directory: join(this.root, '.harness/runtime/previews', id),
        secrets: this.store.secrets(env.id),
        run: this.run,
        onOutput,
      });
      prepared.routeGroup =
        env.maxPreviews === 1
          ? `${this.sandbox.namespace}-project-${project.id}-${env.id}`
          : prepared.name;
      this.store.saveRuntime(id, prepared);
      this.store.savePreview({ ...preview, state: 'starting' });
      await this.run(
        'docker',
        [
          'compose',
          '-p',
          prepared.name,
          '-f',
          prepared.path,
          'up',
          '-d',
          '--remove-orphans',
          '--wait',
          '--wait-timeout',
          '90',
        ],
        { env: prepared.runtimeEnv, timeoutMs: 180_000, onOutput },
      );
      const settings = this.store.settings();
      const urls = await this.router.publish(prepared, settings);
      await this.router.ready(prepared, settings);
      return this.store.savePreview({ ...preview, urls, state: 'ready' });
    } catch (error) {
      await this.router
        .unpublish(`${this.sandbox.namespace}-p-${id}`)
        .catch((cleanupError: unknown) => {
          onOutput?.(
            `Não foi possível remover a rota da prévia: ${cleanupError instanceof Error ? cleanupError.message : 'erro de limpeza'}\n`,
          );
        });
      this.store.savePreview({
        ...preview,
        state: 'failed',
        error: this.store.redact(
          error instanceof Error ? error.message : 'Falha ao iniciar prévia.',
          id,
        ),
      });
      throw error;
    }
  }
  async stop(id: string) {
    const preview = this.store.preview(id);
    const prepared = this.store.runtime(id);
    if (prepared) {
      await this.router.unpublish(prepared.name);
      await this.run(
        'docker',
        ['compose', '-p', prepared.name, '-f', prepared.path, 'down', '--remove-orphans'],
        { env: prepared.runtimeEnv, timeoutMs: 120_000 },
      );
    }
    return this.store.savePreview({ ...preview, state: 'stopped', error: undefined });
  }
  /**
   * Deletes a preview for good: its route, containers, network, volumes (its
   * data) and the images its build produced, then its runtime files and
   * record. The task, branch and worktree are not the preview's and stay.
   */
  async remove(id: string) {
    const preview = this.store.preview(id);
    const prepared = this.store.runtime(id);
    if (prepared) {
      await this.router.unpublish(prepared.name);
      // Without the Compose file (runtime folder already gone) the project name is enough.
      const file = existsSync(prepared.path) ? ['-f', prepared.path] : [];
      await this.run(
        'docker',
        ['compose', '-p', prepared.name, ...file, 'down', '--volumes', '--remove-orphans', '--rmi', 'local'],
        { env: prepared.runtimeEnv, timeoutMs: 180_000 },
      );
    }
    rmSync(join(this.root, '.harness/runtime/previews', id), { recursive: true, force: true });
    this.store.deletePreview(id);
    return { deleted: preview.id };
  }
  async logs(id: string) {
    const preview = this.store.preview(id);
    const prepared = this.store.runtime(id);
    if (!prepared) return '';
    const result = await this.run(
      'docker',
      ['compose', '-p', prepared.name, '-f', prepared.path, 'logs', '--no-color', '--tail', '250'],
      { env: prepared.runtimeEnv, timeoutMs: 15_000, allowFailure: true },
    );
    return this.store.redact(`${result.stdout}${result.stderr}`.slice(-100_000), preview.id);
  }
  async reconcile() {
    for (const preview of this.store.previews().filter((item) => item.state !== 'stopped')) {
      const prepared = this.store.runtime(preview.id);
      if (preview.state === 'failed') {
        if (prepared) await this.router.unpublish(prepared.name);
        continue;
      }
      if (!prepared) {
        this.store.savePreview({
          ...preview,
          state: 'failed',
          error: 'Operação interrompida antes de preparar os serviços.',
        });
        continue;
      }
      try {
        const result = await this.run(
          'docker',
          ['compose', '-p', prepared.name, '-f', prepared.path, 'ps', '--format', 'json', '--all'],
          { env: prepared.runtimeEnv, timeoutMs: 10_000 },
        );
        const states = result.stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .flatMap(
            (line) =>
              JSON.parse(line) as
                | { Service: string; State: string; ExitCode: number; Health: string }
                | { Service: string; State: string; ExitCode: number; Health: string }[],
          );
        const expected =
          prepared.expectedServices ??
          states.map((state) => ({ id: state.Service, completionAllowed: false }));
        if (
          !states.length ||
          expected.some((service) => {
            const state = states.find((item) => item.Service === service.id);
            return (
              !state ||
              !(
                (state.State === 'running' &&
                  state.Health !== 'unhealthy' &&
                  state.Health !== 'starting') ||
                (service.completionAllowed && state.State === 'exited' && state.ExitCode === 0)
              )
            );
          })
        )
          throw new WorkspaceError(
            'Um ou mais serviços estão parados. Consulte os logs ou reinicie a prévia.',
          );
        const urls = await this.router.publish(prepared, this.store.settings());
        await this.router.ready(prepared, this.store.settings(), 5000);
        this.store.savePreview({ ...preview, urls, state: 'ready', error: undefined });
      } catch (error) {
        this.store.savePreview({
          ...preview,
          state: 'failed',
          error: this.store.redact(
            error instanceof Error ? error.message : 'Falha ao consultar containers.',
            preview.id,
          ),
        });
      }
    }
  }
}
