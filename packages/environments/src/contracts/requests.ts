import { z } from 'zod';
import { Id, ProjectSchema, TaskSchema } from '@oinko/workspaces/contracts';
import { EnvironmentSchema, RelativePath, SettingsSchema, Variables } from './index.js';

const RunnerCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('state') }),
  z.object({
    action: z.literal('saveProject'),
    definition: ProjectSchema,
    revision: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal('saveEnvironment'),
    definition: EnvironmentSchema,
    secrets: Variables.default({}),
    revision: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal('saveSettings'),
    definition: SettingsSchema,
    revision: z.number().int().nonnegative(),
  }),
  z.object({ action: z.literal('createTask'), definition: TaskSchema }),
  z.object({ action: z.literal('startSandbox'), projectId: Id }),
  z.object({ action: z.literal('stopSandbox'), projectId: Id }),
  z.object({ action: z.literal('startPreview'), taskId: Id }),
  z.object({ action: z.literal('stopPreview'), previewId: Id }),
  z.object({ action: z.literal('previewLogs'), previewId: Id }),
  z.object({ action: z.literal('jobLogs'), jobId: Id }),
  z.object({
    action: z.literal('shell'),
    taskId: Id,
    repositoryId: Id,
    command: z.string().min(1).max(20_000),
    timeoutSeconds: z.number().int().min(1).max(600).default(120),
  }),
  z.object({ action: z.literal('readFile'), taskId: Id, repositoryId: Id, path: RelativePath }),
  z.object({
    action: z.literal('writeFile'),
    taskId: Id,
    repositoryId: Id,
    path: RelativePath,
    content: z.string().max(200_000),
  }),
]);
export type RunnerCommandInput = z.input<typeof RunnerCommand>;
export const RunnerRequest = z.object({
  command: RunnerCommand,
  botId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,64}$/)
    .optional(),
});
