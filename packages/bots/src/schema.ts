import { z } from 'zod';

export const BotId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const HttpUrl = z.url().refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
}, 'Use uma URL HTTP ou HTTPS sem credenciais.');
export const BotDefinitionSchema = z
  .object({
    id: BotId,
    name: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(200),
    systemPrompt: z.string().trim().min(1).max(100_000),
    baseUrl: HttpUrl.optional(),
    cli: z.boolean().default(true),
    programming: z.boolean().default(false),
    telegram: z
      .object({
        enabled: z.boolean(),
        allowAllPrivateChats: z.boolean().default(false),
        allowedUserIds: z.array(z.string().regex(/^[1-9]\d*$/)).max(100),
      })
      .default({ enabled: false, allowedUserIds: [], allowAllPrivateChats: false }),
    higgsfield: z.boolean().default(false),
    higgsfieldUrl: HttpUrl.optional(),
    higgsfieldTools: z.array(z.string().min(1)).optional(),
    telemetry: z
      .object({
        enabled: z.boolean().default(true),
        capture: z.enum(['full', 'hashed', 'none']).default('full'),
        retentionDays: z.number().int().positive().default(30),
      })
      .default({ enabled: true, capture: 'full', retentionDays: 30 }),
    mcps: z
      .array(
        z.object({
          id: BotId.refine((id) => id !== 'higgsfield', 'ID reservado.'),
          url: HttpUrl,
          enabled: z.boolean().default(true),
        }),
      )
      .max(20)
      .default([]),
    transcriptionModel: z.string().trim().min(1).optional(),
    transcriptionBaseUrl: HttpUrl.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.telegram.enabled &&
      !value.telegram.allowAllPrivateChats &&
      !value.telegram.allowedUserIds.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['telegram', 'allowedUserIds'],
        message: 'Informe pelo menos um usuário autorizado.',
      });
    if (new Set(value.mcps.map((mcp) => mcp.id)).size !== value.mcps.length)
      ctx.addIssue({
        code: 'custom',
        path: ['mcps'],
        message: 'Cada conexão precisa de um ID diferente.',
      });
  });
export type BotDefinition = z.infer<typeof BotDefinitionSchema>;
export const BotSecretsSchema = z.object({
  apiKey: z.string().max(10_000).optional(),
  telegramToken: z.string().max(1000).optional(),
  transcriptionKey: z.string().max(10_000).optional(),
  mcpTokens: z.record(BotId, z.string().max(10_000)).optional(),
});
export type BotSecrets = z.infer<typeof BotSecretsSchema>;
export type BotProfile = BotDefinition & {
  revision: number;
  hasApiKey: boolean;
  hasTelegramToken: boolean;
  hasTranscriptionKey: boolean;
  mcpCredentials: string[];
};
export class BotError extends Error {}
