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
      await this.executor.git(
        project,
        ['worktree', 'add', '-b', task.branch, worktreePath, repo.ref],
        repositoryPath,
      );
    }
  }
}
