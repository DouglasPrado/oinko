import { z } from 'zod';

/**
 * Bot-level programming capability. Absent or `enabled: false` grants nothing:
 * migrating a bot never widens its permissions. There is deliberately no
 * financial ceiling here — only technical limits per command and per cycle.
 */
export const ProgrammingPolicySchema = z.strictObject({
  enabled: z.boolean().default(false),
  /** Highest delivery the bot may reach on its own. */
  autonomy: z.enum(['analysis', 'edit', 'draft_pr']).default('draft_pr'),
  autoResume: z.boolean().default(true),
  cycle: z
    .strictObject({
      /** LLM iterations inside one cycle; the run continues across cycles. */
      maxIterations: z.number().int().min(1).max(200).default(12),
      noProgressLimit: z.number().int().min(1).max(10).default(3),
      commandTimeoutSeconds: z.number().int().min(1).max(3600).default(600),
    })
    .default({ maxIterations: 12, noProgressLimit: 3, commandTimeoutSeconds: 600 }),
  models: z
    .strictObject({
      main: z.string().trim().min(1).max(200).optional(),
      fast: z.string().trim().min(1).max(200).optional(),
      fallbackAfterMs: z.number().int().min(1000).max(120_000).default(15_000),
    })
    .default({ fallbackAfterMs: 15_000 }),
  capabilities: z
    .strictObject({
      browser: z.boolean().default(true),
      publication: z.boolean().default(true),
    })
    .default({ browser: true, publication: true }),
  notifications: z
    .strictObject({
      progress: z.enum(['relevant', 'final', 'none']).default('relevant'),
      minIntervalSeconds: z.number().int().min(5).max(3600).default(30),
    })
    .default({ progress: 'relevant', minIntervalSeconds: 30 }),
});
export type ProgrammingPolicy = z.infer<typeof ProgrammingPolicySchema>;
export const DEFAULT_PROGRAMMING_POLICY: ProgrammingPolicy = ProgrammingPolicySchema.parse({});
