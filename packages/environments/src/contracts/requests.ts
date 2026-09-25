import { z } from 'zod';
import { Id, ProjectSchema, TaskSchema } from '@oinko/workspaces/contracts';
import { EnvironmentSchema, RelativePath, SettingsSchema, Variables } from './index.js';
import { WORKSPACE_COMMANDS } from './workspace-requests.js';
import { BROWSER_COMMANDS } from './browser-requests.js';
import { PUBLICATION_COMMANDS } from './publication-requests.js';

export const RunnerCommand = z.discriminatedUnion('action', [
  ...WORKSPACE_COMMANDS,
  ...BROWSER_COMMANDS,
  ...PUBLICATION_COMMANDS,
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
  z.object({ action: z.literal('startPreview'), taskId: Id, environmentId: Id.optional() }),
  z.object({ action: z.literal('stopPreview'), previewId: Id }),
  z.object({ action: z.literal('deletePreview'), previewId: Id }),
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
export type RunnerCommandValue = z.output<typeof RunnerCommand>;
const EXTENSION_SCHEMAS = [...WORKSPACE_COMMANDS, ...BROWSER_COMMANDS, ...PUBLICATION_COMMANDS];
type ExtensionCommandValue = z.output<(typeof EXTENSION_SCHEMAS)[number]>;
/** Commands the controller itself handles (projects, tasks, sandbox, previews, legacy files). */
export type BaseCommandValue = Exclude<RunnerCommandValue, ExtensionCommandValue>;
const EXTENSION_ACTIONS: ReadonlySet<string> = new Set(
  EXTENSION_SCHEMAS.map((schema) => schema.shape.action.value as string),
);
export function isBaseCommand(command: RunnerCommandValue): command is BaseCommandValue {
  return !EXTENSION_ACTIONS.has(command.action);
}
/** Every command of this build; a runner advertises the ones it handles in `/health`. */
export const RUNNER_ACTIONS: readonly string[] = RunnerCommand.options.map(
  (schema) => schema.shape.action.value as string,
);
/**
 * Whether a runner answering `/health` with `actions` handles `action`.
 * Builds before the list existed only had the base commands.
 */
export function runnerHandles(actions: readonly string[] | undefined, action: string): boolean {
  return actions ? actions.includes(action) : !EXTENSION_ACTIONS.has(action);
}
/** Correlation of a runner call with the programming run that caused it. */
export const RunnerCorrelation = z
  .object({
    runId: z.string().max(100),
    stepId: z.string().max(100),
    operationId: z.string().max(200),
    attemptId: z.string().max(100),
  })
  .partial();
export type RunnerCorrelationValue = z.infer<typeof RunnerCorrelation>;
export const RunnerRequest = z.object({
  command: RunnerCommand,
  botId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,64}$/)
    .optional(),
  correlation: RunnerCorrelation.optional(),
});
