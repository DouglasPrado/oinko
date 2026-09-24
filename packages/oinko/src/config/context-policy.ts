import { z } from 'zod';

/** Input budgets are estimates, independent of a provider's maximum context window. */
export const ContextPolicySchema = z.strictObject({
  enabled: z.boolean().default(false),
  maxInputTokens: z.number().int().min(4096).max(128_000).default(20_000),
  fastInputTokens: z.number().int().min(2048).max(128_000).default(8000),
  recentTokens: z.number().int().min(512).max(64_000).default(6000),
  summaryTokens: z.number().int().min(256).max(8000).default(1200),
  summaryModel: z.string().trim().min(1).optional(),
  toolResultChars: z.number().int().min(512).max(20_000).default(2000),
  selectTools: z.boolean().default(true),
  maxTools: z.number().int().min(1).max(64).default(10),
  minToolConfidence: z.number().min(0).max(1).default(0.7),
});

export type ContextPolicy = z.output<typeof ContextPolicySchema>;
