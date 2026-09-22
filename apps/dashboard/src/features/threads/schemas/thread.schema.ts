import { z } from 'zod';

export const ThreadSummarySchema = z.object({
  threadId: z.string(),
  executionCount: z.number().int(),
  totalTokens: z.number().int(),
  /** Null quando nenhuma execucao da thread teve custo confirmado. */
  costUsd: z.number().nullable(),
  /** Execucoes cujo custo o provedor nao informou. */
  unknownCostCount: z.number().int(),
  errorCount: z.number().int(),
  lastModel: z.string(),
  lastStartedAt: z.number().int(),
  totalDurationMs: z.number().int(),
});

export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;

export const ThreadFiltersSchema = z.object({
  q: z.string().trim().default(''),
  model: z.string().trim().default(''),
  status: z.enum(['all', 'ok', 'error']).default('all'),
});

export type ThreadFilters = z.infer<typeof ThreadFiltersSchema>;
