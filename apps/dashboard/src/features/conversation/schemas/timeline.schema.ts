import { z } from 'zod';

const PayloadRefSchema = z.object({
  id: z.string(),
  sizeBytes: z.number().int(),
  preview: z.string(),
  redacted: z.boolean(),
});

export type PayloadRef = z.infer<typeof PayloadRefSchema>;

const CostStatusSchema = z.enum(['pending', 'confirmed', 'unavailable']);

const ExecutionSummarySchema = z.object({
  traceId: z.string(),
  threadId: z.string(),
  app: z.string().nullable(),
  model: z.string(),
  status: z.string(),
  endReason: z.string().nullable(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  totalTokens: z.number().int(),
  costUsd: z.number().nullable(),
  costStatus: CostStatusSchema,
  contextTokens: z.number().int().nullable(),
  startedAt: z.number().int(),
  durationMs: z.number().int().nullable(),
  ttftMs: z.number().int().nullable(),
  errorMessage: z.string().nullable(),
});

export type ExecutionSummary = z.infer<typeof ExecutionSummarySchema>;

const InjectionSchema = z.object({
  source: z.string(),
  tokens: z.number().int(),
  applied: z.boolean(),
});

export type Injection = z.infer<typeof InjectionSchema>;

const BaseItem = { id: z.string(), startedAt: z.number().int(), durationMs: z.number().int() };

const TimelineItemSchema = z.discriminatedUnion('kind', [
  z.object({
    ...BaseItem,
    kind: z.literal('llm_call'),
    seq: z.number().int(),
    model: z.string(),
    finishReason: z.string().nullable(),
    inputTokens: z.number().int().nullable(),
    outputTokens: z.number().int().nullable(),
    cachedTokens: z.number().int().nullable(),
    costUsd: z.number().nullable(),
    costStatus: CostStatusSchema,
    costSource: z.string().nullable(),
    ttftMs: z.number().int().nullable(),
    generationId: z.string().nullable(),
    providerName: z.string().nullable(),
    request: PayloadRefSchema.nullable(),
    response: PayloadRefSchema.nullable(),
  }),
  z.object({
    ...BaseItem,
    kind: z.literal('tool_call'),
    name: z.string(),
    origin: z.enum(['builtin', 'skill', 'mcp', 'custom']),
    isError: z.boolean(),
    truncated: z.boolean(),
    args: PayloadRefSchema.nullable(),
    result: PayloadRefSchema.nullable(),
  }),
  z.object({
    ...BaseItem,
    kind: z.literal('mcp_call'),
    serverName: z.string(),
    remoteToolName: z.string(),
    isError: z.boolean(),
    timedOut: z.boolean(),
    request: PayloadRefSchema.nullable(),
    response: PayloadRefSchema.nullable(),
  }),
  z.object({
    ...BaseItem,
    kind: z.literal('decision'),
    point: z.string(),
    answers: z.record(z.string(), z.unknown()),
  }),
]);

export type TimelineItem = z.infer<typeof TimelineItemSchema>;

export const ExecutionDetailSchema = z.object({
  execution: ExecutionSummarySchema,
  systemPrompt: PayloadRefSchema.nullable(),
  userInput: PayloadRefSchema.nullable(),
  assistantText: PayloadRefSchema.nullable(),
  toolsSchema: PayloadRefSchema.nullable(),
  injections: z.array(InjectionSchema),
  items: z.array(TimelineItemSchema),
});

export type ExecutionDetail = z.infer<typeof ExecutionDetailSchema>;
