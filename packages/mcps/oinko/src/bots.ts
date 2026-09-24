import { z } from 'zod';
import { BotDefinitionSchema, BotId, BotSecretsSchema } from '@oinko/bots/schema';
import { BotStore } from '@oinko/bots/store';
import { BotManager, type BotStatus } from '@oinko/bots/manager';
import { openProgramming, recordBotConfiguration } from '@oinko/bots/programming';

const fields = BotDefinitionSchema.shape;
const telegram = fields.telegram.removeDefault().shape;
const telemetry = fields.telemetry.removeDefault().shape;

// Remove defaults before making a patch optional: omitted fields must stay omitted.
const BotChanges = z.strictObject({
  name: fields.name.optional(),
  model: fields.model.optional(),
  systemPrompt: fields.systemPrompt.optional(),
  baseUrl: fields.baseUrl.nullable(),
  context: fields.context
    .nullable()
    .describe(
      'Política completa de contexto: enabled, maxInputTokens, fastInputTokens, recentTokens, summaryTokens, toolResultChars, selectTools, maxTools e minToolConfidence. Campos internos omitidos usam os padrões. null desabilita; não apaga histórico.',
    ),
  intelligence: fields.intelligence
    .nullable()
    .describe(
      'Configuração completa do Jev: enabled, fastModel opcional e minConfidence. null desabilita. Requer credentials.typesafeKey ao habilitar pela primeira vez.',
    ),
  cli: fields.cli.removeDefault().optional(),
  programming: fields.programming.removeDefault().optional(),
  programmingPolicy: fields.programmingPolicy
    .nullable()
    .describe(
      'Política completa de trabalhos de programação duráveis: enabled, autonomy (analysis|edit|draft_pr), autoResume, cycle, models (main, fast, fallbackAfterMs, minConfidence do Jev), context (selectTools, maxTools), capabilities (browser, publication) e notifications. Modelo rápido e seleção de ferramentas exigem o Jev. null desabilita. Não existe teto de gasto.',
    ),
  conversationSearch: fields.conversationSearch.removeDefault().optional(),
  telegram: z
    .strictObject({
      enabled: telegram.enabled.optional(),
      allowAllPrivateChats: telegram.allowAllPrivateChats.removeDefault().optional(),
      allowedUserIds: telegram.allowedUserIds.optional(),
    })
    .optional(),
  higgsfield: fields.higgsfield.removeDefault().optional(),
  higgsfieldUrl: fields.higgsfieldUrl.nullable(),
  higgsfieldTools: fields.higgsfieldTools.nullable(),
  telemetry: z
    .strictObject({
      enabled: telemetry.enabled.removeDefault().optional(),
      capture: telemetry.capture.removeDefault().optional(),
      retentionDays: telemetry.retentionDays.removeDefault().optional(),
    })
    .optional(),
  mcps: fields.mcps.removeDefault().optional(),
  transcriptionModel: fields.transcriptionModel.nullable(),
  transcriptionBaseUrl: fields.transcriptionBaseUrl.nullable(),
});

export const BotQuery = z.strictObject({ botId: BotId.optional() });
export const BotUpdate = z.strictObject({
  botId: BotId,
  revision: z
    .number()
    .int()
    .positive()
    .describe('Revisão atual de oinko_bots. Obrigatória para evitar sobrescrever outra edição.'),
  changes: BotChanges.default({}).describe(
    'Somente campos alterados. Telegram e telemetria fazem merge; arrays são substituídos. null limpa campos opcionais.',
  ),
  credentials: BotSecretsSchema.strict()
    .optional()
    .describe(
      'Somente escrita. Omitir ou deixar vazio preserva credenciais. Prefira digitá-las na dashboard, pois o cliente MCP pode registrar os argumentos.',
    ),
});

async function withBots<T>(
  root: string | undefined,
  run: (store: BotStore, manager: BotManager) => Promise<T>,
): Promise<T> {
  if (!root) throw new Error('Informe a raiz de dados para administrar os bots.');
  const store = new BotStore(root);
  try {
    return await run(store, new BotManager(store));
  } finally {
    store.close();
  }
}

export function queryBots(root: string | undefined, botId?: string) {
  return withBots(root, async (store, manager) => ({
    bots: await Promise.all(
      (botId ? [store.get(botId)] : store.list()).map(async (bot) => ({
        ...bot,
        status: await manager.status(bot.id),
      })),
    ),
  }));
}

function activation(status: BotStatus) {
  if (status.state === 'stopped') return 'next_start';
  if (status.state !== 'running') return 'unknown';
  return status.needsRestart ? 'restart_required' : 'applied';
}

export function updateBot(root: string | undefined, input: z.output<typeof BotUpdate>) {
  return withBots(root, async (store, manager) => {
    const { botId, revision, changes, credentials } = BotUpdate.parse(input);
    const hasCredentials = Object.values(credentials ?? {}).some((value) =>
      typeof value === 'string'
        ? Boolean(value.trim())
        : Object.values(value).some((token) => Boolean(token.trim())),
    );
    if (!Object.keys(changes).length && !hasCredentials)
      throw new Error('Informe ao menos uma alteração.');
    const current = store.get(botId);
    const patch = Object.fromEntries(
      Object.entries(changes).map(([key, value]) => [key, value === null ? undefined : value]),
    );
    const definition = BotDefinitionSchema.parse({
      ...current,
      ...patch,
      telegram: { ...current.telegram, ...changes.telegram },
      telemetry: { ...current.telemetry, ...changes.telemetry },
    });
    const before = store.runtime(botId).definition;
    const bot = store.save(definition, credentials ?? {}, revision);
    const programming = openProgramming({ root: root!, producer: 'mcp', bots: store });
    try {
      recordBotConfiguration(programming.journal, before, BotDefinitionSchema.parse(bot), 'operator', bot.revision);
    } finally {
      await programming.close();
    }
    const status = await manager.status(botId);
    return { saved: true, bot, status, activation: activation(status) };
  });
}
