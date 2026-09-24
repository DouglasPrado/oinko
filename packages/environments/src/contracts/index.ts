import { z } from 'zod';
import { Id } from '@oinko/workspaces/contracts';

export const RelativePath = z
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
export const ImageName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,240}$/);
export const Variables = z.record(
  z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  z.string().max(10_000),
);
export const ServiceSchema = z
  .object({
    id: Id,
    repositoryId: Id.optional(),
    builder: z.enum(['image', 'dockerfile', 'railpack']).default('image'),
    image: ImageName.default('node:22-alpine'),
    context: RelativePath.default('.'),
    dockerfile: RelativePath.default('Dockerfile'),
    buildTarget: z
      .string()
      .regex(/^[A-Za-z0-9_-]*$/)
      .max(100)
      .default(''),
    buildCommand: z.string().max(4000).default(''),
    buildEnvironment: Variables.default({}),
    command: z.string().max(4000).default(''),
    mode: z.enum(['image', 'development']).default('image'),
    workdir: RelativePath.default('.'),
    port: z.number().int().min(1).max(65535).default(3000),
    expose: z.boolean().default(false),
    healthPath: z
      .string()
      .max(200)
      .regex(/^\/(?!\/)[^\s]*$/)
      .default('/'),
    environment: Variables.default({}),
    secrets: z
      .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/))
      .max(100)
      .default([]),
    dependsOn: z.array(Id).max(20).default([]),
    volumes: z
      .array(z.object({ name: Id, target: z.string().regex(/^\/[A-Za-z0-9/_.-]+$/) }))
      .max(10)
      .default([]),
  })
  .refine(
    (service) =>
      (service.builder === 'image' && service.mode === 'image') || !!service.repositoryId,
    'Selecione o repositório do serviço.',
  );
export const EnvironmentSchema = z
  .object({
    id: Id,
    name: z.string().trim().min(1).max(100),
    workspaceImage: ImageName.default('oinko-workspace:1'),
    cpus: z.number().min(0.25).max(32).default(2),
    memoryMb: z.number().int().min(128).max(65536).default(2048),
    network: z.enum(['internet', 'none']).default('internet'),
    maxPreviews: z.number().int().min(1).max(8).default(1),
    compose: z.object({ repositoryId: Id, path: RelativePath }).optional(),
    services: z.array(ServiceSchema).max(30).default([]),
  })
  .superRefine((environment, ctx) => {
    const names = new Set(environment.services.map((service) => service.id));
    if (names.size !== environment.services.length)
      ctx.addIssue({ code: 'custom', path: ['services'], message: 'IDs de serviço duplicados.' });
    for (const service of environment.services) {
      if (
        service.dependsOn.includes(service.id) ||
        (!environment.compose && service.dependsOn.some((id) => !names.has(id)))
      )
        ctx.addIssue({ code: 'custom', path: ['services'], message: 'Dependências inválidas.' });
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      const service = environment.services.find((item) => item.id === id);
      if (service?.dependsOn.some(visit)) return true;
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    if (environment.services.some((service) => visit(service.id)))
      ctx.addIssue({
        code: 'custom',
        path: ['services'],
        message: 'Existe um ciclo nas dependências dos serviços.',
      });
  });
export const SettingsSchema = z.object({
  id: z.literal('settings').default('settings'),
  port: z.number().int().min(1024).max(65535).default(3180),
  domain: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,200}$/)
    .default('127.0.0.1.sslip.io'),
  bindAddress: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
});
export type Environment = z.infer<typeof EnvironmentSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export interface Preview {
  id: string;
  projectId: string;
  taskId: string;
  environmentId: string;
  state: 'building' | 'starting' | 'ready' | 'stopped' | 'failed';
  urls: { serviceId: string; url: string }[];
  createdAt: string;
  error?: string;
}
export interface Job {
  id: string;
  projectId?: string;
  type: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed';
  createdAt: string;
  finishedAt?: string;
  error?: string;
  result?: unknown;
  /** Bot that asked for the job, when not the administrator. */
  botId?: string;
  /** Programming operation this job belongs to, for reconciliation. */
  operationId?: string;
  taskId?: string;
  repositoryId?: string;
  /** The runner restarted while it ran: the outcome is unknown, not a known failure. */
  interrupted?: boolean;
  /** Stopped on request; files and commits were preserved. */
  cancelled?: boolean;
}
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  input?: string;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  allowFailure?: boolean;
}
export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandOptions,
) => Promise<CommandResult>;
