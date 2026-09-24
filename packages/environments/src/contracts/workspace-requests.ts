import { z } from 'zod';
import { Id } from '@oinko/workspaces/contracts';
import { RelativePath } from './index.js';

/** Where a workspace operation happens: one repository worktree of a ready task. */
const Location = { taskId: Id, repositoryId: Id };
const Hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Filter = {
  /** Restrict to a package/sub-directory of the repository. */
  path: RelativePath.optional(),
  /** Glob on the relative path, e.g. `src/**\/*.ts`. */
  glob: z.string().min(1).max(300).optional(),
  /** Explicit override: include files ignored by Git (node_modules, build output...). */
  includeIgnored: z.boolean().default(false),
  /** Explicit override: include generated/lock files excluded by default. */
  includeGenerated: z.boolean().default(false),
  cursor: z.string().max(500).optional(),
};

export const EditSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('replace'),
    path: RelativePath,
    expectedHash: Hash,
    oldText: z.string().min(1).max(200_000),
    newText: z.string().max(200_000),
    replaceAll: z.boolean().default(false),
  }),
  z.object({ action: z.literal('create'), path: RelativePath, content: z.string().max(400_000) }),
  z.object({ action: z.literal('delete'), path: RelativePath, expectedHash: Hash }),
]);
export type WorkspaceEdit = z.infer<typeof EditSchema>;

export const WORKSPACE_COMMANDS = [
  z.object({
    action: z.literal('searchPaths'),
    ...Location,
    ...Filter,
    query: z.string().max(300).default(''),
    limit: z.number().int().min(1).max(1000).default(200),
  }),
  z.object({
    action: z.literal('searchContent'),
    ...Location,
    ...Filter,
    query: z.string().min(1).max(1000),
    regex: z.boolean().default(false),
    caseSensitive: z.boolean().default(false),
    contextLines: z.number().int().min(0).max(5).default(0),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  z.object({
    action: z.literal('readRange'),
    ...Location,
    path: RelativePath,
    startLine: z.number().int().min(1).default(1),
    endLine: z.number().int().min(1).optional(),
    maxBytes: z.number().int().min(256).max(200_000).default(64_000),
  }),
  z.object({
    action: z.literal('replaceExact'),
    ...Location,
    operationId: z.string().min(1).max(200),
    path: RelativePath,
    expectedHash: Hash,
    oldText: z.string().min(1).max(200_000),
    newText: z.string().max(200_000),
    replaceAll: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('applyPatch'),
    ...Location,
    operationId: z.string().min(1).max(200),
    edits: z.array(EditSchema).min(1).max(50),
  }),
  z.object({ action: z.literal('reconcileEdit'), ...Location, operationId: z.string().min(1).max(200) }),
  z.object({ action: z.literal('gitSnapshot'), ...Location }),
  z.object({
    action: z.literal('gitDiff'),
    ...Location,
    /** Snapshot taken at run start: changes that existed before are not attributed to the run. */
    baseline: z
      .object({ headSha: z.string().max(64), files: z.record(z.string(), z.string()).default({}) })
      .optional(),
    maxPatchBytes: z.number().int().min(1000).max(2_000_000).default(200_000),
  }),
  z.object({
    action: z.literal('projectContext'),
    ...Location,
    targets: z.array(RelativePath).max(50).default([]),
  }),
  z.object({
    action: z.literal('startCheck'),
    ...Location,
    operationId: z.string().min(1).max(200),
    kind: z.enum(['install', 'test', 'lint', 'build', 'typecheck', 'format', 'custom']),
    command: z.string().min(1).max(4000),
    cwd: RelativePath.default('.'),
    timeoutSeconds: z.number().int().min(1).max(3600).default(600),
  }),
  z.object({ action: z.literal('inspectJob'), jobId: Id }),
  z.object({ action: z.literal('stopJob'), jobId: Id, graceSeconds: z.number().int().min(0).max(60).default(5) }),
] as const;
export type WorkspaceCommandValue = z.output<(typeof WORKSPACE_COMMANDS)[number]>;
