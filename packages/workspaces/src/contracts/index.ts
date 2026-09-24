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
const BotRef = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
/** Relative, normalized path inside a repository; never absolute or escaping. */
export const RepoPath = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.split('/').includes('..') &&
      !value.includes('\0'),
    'Use um caminho relativo dentro do repositório.',
  );
export const CHECK_KINDS = ['install', 'test', 'lint', 'build', 'typecheck', 'format'] as const;
const Origin = z
  .string()
  .max(300)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, 'Use uma origem http(s) sem caminho nem credenciais, como https://app.exemplo.com.');
/**
 * Programming configuration owned by the project. Optional: projects saved
 * before this field existed keep working and grant no new capability.
 */
export const ProjectProgrammingSchema = z.object({
  /** Explicit commands per package; they win over detection. */
  commands: z
    .array(
      z.object({
        repositoryId: Id,
        path: RepoPath.default('.'),
        kind: z.enum(CHECK_KINDS),
        command: z.string().trim().min(1).max(4000),
      }),
    )
    .max(100)
    .default([]),
  browser: z
    .object({
      enabled: z.boolean().default(false),
      /** Extra origins beyond the project's own previews; never a whole network. */
      allowedOrigins: z.array(Origin).max(20).default([]),
      publicDocs: z.boolean().default(true),
      /** Names of test credentials stored in the project vault; values never live here. */
      credentials: z
        .array(z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/))
        .max(20)
        .default([]),
    })
    .default({ enabled: false, allowedOrigins: [], publicDocs: true, credentials: [] }),
  github: z
    .object({
      installationId: z.number().int().positive().optional(),
      repositories: z
        .array(
          z.object({
            repositoryId: Id,
            owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/),
            name: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
            baseBranch: GitRef.default('main'),
          }),
        )
        .max(12)
        .default([]),
    })
    .default({ repositories: [] }),
  /** Subset of allowedBotIds that may publish draft PRs for this project. */
  publisherBotIds: z.array(BotRef).max(100).default([]),
});
export type ProjectProgramming = z.infer<typeof ProjectProgrammingSchema>;

export const ProjectSchema = z
  .object({
    id: Id,
    name: z.string().trim().min(1).max(100),
    environmentId: Id.optional(),
    environmentIds: z
      .array(Id)
      .max(24)
      .refine((ids) => new Set(ids).size === ids.length, 'Ambientes duplicados.')
      .optional(),
    repositories: z.array(RepositorySchema).min(1).max(12),
    allowedBotIds: z
      .array(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/))
      .max(100)
      .default([]),
    programming: ProjectProgrammingSchema.optional(),
  })
  .refine(
    (value) =>
      new Set(value.repositories.map((repo) => repo.id)).size === value.repositories.length,
    'IDs de repositório duplicados.',
  )
  .superRefine((value, ctx) => {
    const programming = value.programming;
    if (!programming) return;
    const repositories = new Set(value.repositories.map((repo) => repo.id));
    for (const [index, entry] of programming.commands.entries())
      if (!repositories.has(entry.repositoryId))
        ctx.addIssue({
          code: 'custom',
          path: ['programming', 'commands', index, 'repositoryId'],
          message: 'Repositório não pertence ao projeto.',
        });
    for (const [index, entry] of programming.github.repositories.entries())
      if (!repositories.has(entry.repositoryId))
        ctx.addIssue({
          code: 'custom',
          path: ['programming', 'github', 'repositories', index, 'repositoryId'],
          message: 'Repositório não pertence ao projeto.',
        });
    for (const [index, botId] of programming.publisherBotIds.entries())
      if (!value.allowedBotIds.includes(botId))
        ctx.addIssue({
          code: 'custom',
          path: ['programming', 'publisherBotIds', index],
          message: 'Somente bots autorizados no projeto podem publicar.',
        });
  });
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
