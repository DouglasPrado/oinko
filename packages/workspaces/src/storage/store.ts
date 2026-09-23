import { join } from 'node:path';
import { LocalDatabase } from './database.js';
import {
  ProjectSchema,
  TaskSchema,
  WorkspaceError,
  type Project,
  type Task,
} from '../contracts/index.js';

export class WorkspaceStore {
  private readonly db: LocalDatabase;
  constructor(readonly root: string) {
    this.db = new LocalDatabase(join(root, '.harness/workspaces.db'));
  }
  projects() {
    return this.db.list<Project>('project');
  }
  project(id: string) {
    const project = this.db.get<Project>('project', id);
    if (!project) throw new WorkspaceError('Projeto não encontrado.');
    return project;
  }
  saveProject(input: unknown, revision: number) {
    return this.db.save('project', ProjectSchema.parse(input), revision);
  }
  tasks(projectId?: string) {
    return this.db.list<Task>('task').filter((task) => !projectId || task.projectId === projectId);
  }
  task(id: string) {
    const task = this.db.get<Task>('task', id);
    if (!task) throw new WorkspaceError('Tarefa não encontrada.');
    return task;
  }
  saveTask(input: unknown, revision: number) {
    const task = TaskSchema.parse(input);
    this.project(task.projectId);
    return this.db.save('task', task, revision);
  }
  authorize(projectId: string, botId?: string) {
    const project = this.project(projectId);
    if (botId && !project.allowedBotIds.includes(botId))
      throw new WorkspaceError('Bot não autorizado neste projeto.');
    return project;
  }
  close() {
    this.db.close();
  }
}
