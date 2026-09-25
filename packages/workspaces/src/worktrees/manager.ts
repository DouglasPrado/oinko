import { type Project, type Task, type WorkspaceExecutor } from '../contracts/index.js';

export class WorktreeManager {
  constructor(private readonly executor: WorkspaceExecutor) {}
  async create(project: Project, task: Task) {
    for (const repo of project.repositories) {
      const repositoryPath = `/workspace/repositories/${repo.id}`;
      const present = await this.executor
        .git(project, ['rev-parse', '--is-inside-work-tree'], repositoryPath)
        .then(
          () => true,
          () => false,
        );
      if (!present) {
        if (repo.source.startsWith('/'))
          await this.executor.importLocal(project, repo.id, repo.source);
        else
          await this.executor.git(
            project,
            ['clone', '--no-checkout', '--', repo.source, repositoryPath],
            '/workspace',
          );
      }
      // Worktrees live on a host folder mounted into the sandbox, where ctime and
      // inode flicker: Git would see local changes that do not exist and refuse
      // rebase and merge ("would be overwritten"). Idempotent, so older clones get it too.
      for (const [key, value] of [
        ['core.trustctime', 'false'],
        ['core.checkStat', 'minimal'],
      ] as const)
        await this.executor.git(project, ['config', key, value], repositoryPath);
      const worktreePath = `/workspace/tasks/${task.id}/${repo.id}`;
      const existing = await this.executor
        .git(project, ['branch', '--show-current'], worktreePath)
        .catch(() => undefined);
      if (existing?.trim() === task.branch) continue;
      await this.executor.git(
        project,
        ['check-ref-format', '--branch', task.branch],
        repositoryPath,
      );
      let base = repo.ref;
      if (!repo.source.startsWith('/')) {
        // A managed clone's local HEAD stays at its initial commit. Resolve the
        // selected remote ref afresh only when creating a new worktree.
        const remoteRef = repo.ref.replace(/^(?:refs\/remotes\/)?origin\//, '');
        await this.executor.git(
          project,
          ['fetch', '--no-tags', '--', 'origin', remoteRef],
          repositoryPath,
        );
        base = (
          await this.executor.git(
            project,
            ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'],
            repositoryPath,
          )
        ).trim();
      }
      await this.executor.git(
        project,
        ['worktree', 'add', '-b', task.branch, worktreePath, base],
        repositoryPath,
      );
    }
  }
}
