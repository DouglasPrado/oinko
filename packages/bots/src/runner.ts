import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  createAgentHost,
  serviceSocketPath,
  startAgentService,
  type Connections,
} from '@oinko/agent-runtime';
import { cliChannel } from '@oinko/channel-cli';
import { telegramChannel } from '@oinko/channel-telegram';
import { higgsfieldMcp, HIGGSFIELD_INSTRUCTIONS } from '@oinko/mcp-higgsfield';
import { BotError } from './schema.js';
import type { BotStore } from './store.js';
import { programmingTools, PROGRAMMING_INSTRUCTIONS } from './programming-tools.js';

export async function runBot(store: BotStore, id: string, onClose: () => void) {
  const { definition: bot, secrets, paths, revision } = store.runtime(id);
  if (!secrets.apiKey) throw new BotError('Configure a chave da API do modelo antes de iniciar.');
  if (bot.telegram.enabled && !secrets.telegramToken)
    throw new BotError('Configure o token do Telegram antes de iniciar.');
  const connections: Connections = { channels: [], mcps: [] };
  if (bot.cli) connections.channels.push({ id: 'local', type: 'cli', enabled: true, options: {} });
  if (bot.telegram.enabled)
    connections.channels.push({
      id: 'telegram',
      type: 'telegram',
      enabled: true,
      options: {
        token: secrets.telegramToken,
        allowedUserIds: bot.telegram.allowedUserIds,
        allowAllPrivateChats: bot.telegram.allowAllPrivateChats,
      },
    });
  if (bot.higgsfield)
    connections.mcps.push({
      id: 'higgsfield',
      type: 'higgsfield',
      enabled: true,
      options: {
        credentialPath:
          paths.higgsfieldCredentialPath ??
          process.env.HIGGSFIELD_CREDENTIAL_PATH ??
          join(store.root, '.harness/credentials/higgsfield.json'),
        url: bot.higgsfieldUrl,
        tools: bot.higgsfieldTools,
      },
    });
  for (const mcp of bot.mcps)
    connections.mcps.push({
      id: mcp.id,
      type: 'mcp',
      enabled: mcp.enabled,
      options: {
        transport: 'http',
        url: mcp.url,
        ...(secrets.mcpTokens?.[mcp.id]
          ? { headers: { Authorization: `Bearer ${secrets.mcpTokens[mcp.id]}` } }
          : {}),
      },
    });
  return startAgentService({
    socketPath: serviceSocketPath(paths.dataDir),
    connectionClaims:
      bot.telegram.enabled && secrets.telegramToken
        ? [`telegram:${createHash('sha256').update(secrets.telegramToken).digest('hex')}`]
        : [],
    revision,
    onClose,
    createHost: () =>
      createAgentHost({
        id,
        ...paths,
        telemetryEnabled: bot.telemetry.enabled,
        capturePayloads: bot.telemetry.capture,
        retentionDays: bot.telemetry.retentionDays,
        tools: bot.programming ? programmingTools(store.root, bot.id) : [],
        conversationSearch: bot.conversationSearch,
        agent: {
          apiKey: secrets.apiKey!,
          model: bot.model,
          baseUrl: bot.baseUrl,
          systemPrompt:
            bot.systemPrompt +
            (bot.higgsfield ? HIGGSFIELD_INSTRUCTIONS : '') +
            (bot.programming ? PROGRAMMING_INSTRUCTIONS : ''),
          transcription: {
            apiKey: secrets.transcriptionKey,
            baseUrl: bot.transcriptionBaseUrl,
            model: bot.transcriptionModel,
          },
        },
      }),
    loadConnections: async () => connections,
    channels: { cli: cliChannel, telegram: telegramChannel },
    mcps: { higgsfield: higgsfieldMcp },
  });
}
