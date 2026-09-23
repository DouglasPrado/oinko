import { z } from 'zod';

export class WorkspaceError extends Error {}
export const Id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
export const GitRef = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/)
  .refine(
    (value) =>
      !value.includes('..') &&
      !value.includes('//') &&
      !value.endsWith('/') &&
      !value.endsWith('.') &&
      !value.endsWith('.lock'),
    'Referência Git inválida.',
  );
export const RepositorySchema = z.object({
  id: Id,
  source: z
    .string()
    .min(1)
    .max(2000)
    .refine((value) => {
      if (/[\0\r\n]/.test(value)) return false;
      if (value.startsWith('/')) return true;
      try {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          !!url.hostname &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          !/\s/.test(value)
        );
      } catch {
        return false;
      }
    }, 'Use um caminho local absoluto ou URL HTTPS sem credenciais, parâmetros ou fragmentos.'),
  ref: GitRef.default('HEAD'),
});
export const ProjectSchema = z
  .object({
    id: Id,
    name: z.string().trim().min(1).max(100),
    environmentId: Id,
    repositories: z.array(RepositorySchema).min(1).max(12),
    allowedBotIds: z
      .array(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/))
      .max(100)
      .default([]),
  })
  .refine(
    (value) =>
      new Set(value.repositories.map((repo) => repo.id)).size === value.repositories.length,
    'IDs de repositório duplicados.',
  );
export const TaskSchema = z.object({
  id: Id,
  projectId: Id,
  name: z.string().trim().min(1).max(120),
  branch: GitRef,
  state: z.enum(['creating', 'ready', 'failed']).default('creating'),
  error: z.string().optional(),
  createdAt: z.string().default(() => new Date().toISOString()),
});
export type Project = z.infer<typeof ProjectSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Saved<T> = T & { revision: number };

/** All Git commands run through a controlled executor; workspaces never runs repository code. */
export interface WorkspaceExecutor {
  git(project: Project, args: string[], cwd: string): Promise<string>;
  importLocal(project: Project, repositoryId: string, source: string): Promise<void>;
}
