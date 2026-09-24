import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { JevDecider } from '@oinko/core';
import {
  createAgentHost,
  serviceSocketPath,
  startAgentService,
  type Connections,
} from '@oinko/agent-runtime';
import {
  AgentCycleExecutor,
  PROGRAMMING_CHAT_INSTRUCTIONS,
  PROGRAMMING_RUN_INSTRUCTIONS,
  programmingChatTools,
  type Evidence,
  type RunExecutor,
} from '@oinko/agent-runtime/programming';
import { EnvironmentClient } from '@oinko/environments/client';
import { cliChannel } from '@oinko/channel-cli';
import { telegramChannel } from '@oinko/channel-telegram';
import { higgsfieldMcp, HIGGSFIELD_INSTRUCTIONS } from '@oinko/mcp-higgsfield';
import { BotError } from './schema.js';
import type { BotStore } from './store.js';
import { programmingTools, PROGRAMMING_INSTRUCTIONS } from './programming-tools.js';
import { openProgramming } from './programming/runtime.js';
import { isOinkoMcp, scopeOinkoMcp } from './programming/equivalence.js';
import { programmingRunTools } from './programming/run-tools.js';
import { deliveryTools } from './programming/delivery-tools.js';

export interface RunBotOptions {
  /** Test seam: in-process model provider instead of the network (never set by the CLI/dashboard). */
  fetch?: (request: Request) => Promise<Response>;
}

export async function runBot(store: BotStore, id: string, onClose: () => void, options: RunBotOptions = {}) {
  const { definition: bot, secrets, paths, revision } = store.runtime(id);
  if (!secrets.apiKey) throw new BotError('Configure a chave da API do modelo antes de iniciar.');
  if (bot.telegram.enabled && !secrets.telegramToken)
    throw new BotError('Configure o token do Telegram antes de iniciar.');
  if (bot.intelligence?.enabled && !secrets.typesafeKey)
    throw new BotError('Configure a chave da TypeSafe antes de habilitar o Jev.');
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
  // Tools this bot already has internally: an Oinko MCP connection must not add copies.
  const internalTools = new Set<string>([
    ...(bot.programming
      ? ['workspace_status', 'workspace_task', 'workspace_exec', 'workspace_read', 'workspace_write', 'workspace_preview', 'workspace_logs']
      : []),
    ...(bot.programmingPolicy?.enabled ? ['programming_start', 'programming_status', 'programming_steer', 'programming_control'] : []),
  ]);
  for (const mcp of bot.mcps)
    connections.mcps.push({
      id: mcp.id,
      type: 'mcp',
      enabled: mcp.enabled,
      options:
        mcp.transport === 'stdio'
          ? isOinkoMcp(mcp.command, mcp.args)
            ? { transport: 'stdio', command: mcp.command, ...scopeOinkoMcp(bot.id, mcp.args, internalTools) }
            : { transport: 'stdio', command: mcp.command, args: mcp.args }
          : {
              transport: 'http',
              url: mcp.url,
              ...(secrets.mcpTokens?.[mcp.id]
                ? { headers: { Authorization: `Bearer ${secrets.mcpTokens[mcp.id]}` } }
                : {}),
            },
    });
  // Durable programming runs: same code for every bot, enabled by its policy.
  const policy = bot.programmingPolicy;
  const runner = policy?.enabled ? new EnvironmentClient(store.root, bot.id) : undefined;
  let cycles: RunExecutor | undefined;
  const programming = runner
    ? openProgramming({
        root: store.root,
        producer: `runtime:${bot.id}`,
        executeFor: bot.id,
        bots: store,
        runner,
        executor: {
          runCycle: (input) => {
            if (!cycles) throw new BotError('O agente de programação ainda não está pronto.');
            return cycles.runCycle(input);
          },
        },
        secrets: () =>
          [
            secrets.apiKey,
            secrets.telegramToken,
            secrets.transcriptionKey,
            secrets.typesafeKey,
            ...Object.values(secrets.mcpTokens ?? {}),
          ].filter((value): value is string => !!value),
      })
    : undefined;
  const decider = bot.intelligence?.enabled
    ? new JevDecider({ apiKey: secrets.typesafeKey!, timeout: 15_000 })
    : undefined;
  return startAgentService({
    socketPath: serviceSocketPath(paths.dataDir),
    connectionClaims:
      bot.telegram.enabled && secrets.telegramToken
        ? [`telegram:${createHash('sha256').update(secrets.telegramToken).digest('hex')}`]
        : [],
    revision,
    onClose,
    createHost: () => {
      const host = createAgentHost({
        id,
        ...paths,
        telemetryEnabled: bot.telemetry.enabled,
        capturePayloads: bot.telemetry.capture,
        retentionDays: bot.telemetry.retentionDays,
        tools: [
          ...(bot.programming ? programmingTools(store.root, bot.id) : []),
          ...(programming
            ? programmingChatTools({
                botId: bot.id,
                service: programming.service,
                queries: programming.queries,
                access: programming.access,
                journal: programming.journal,
              })
            : []),
        ],
        conversationSearch: bot.conversationSearch,
        ...(programming?.commands && { commands: programming.commands }),
        ...(programming && { notifications: programming.notifier }),
        ...(programming &&
          runner &&
          policy && {
            programming: {
              tools: [
                ...programmingRunTools({ runner, service: programming.service }),
                ...deliveryTools({
                  runner,
                  access: programming.access,
                  service: programming.service,
                  evidence: (runId) => programming.store.evidence<Evidence>(runId).map((item) => item.value),
                  journal: programming.journal,
                  capabilities: policy.capabilities,
                }),
              ],
              systemPrompt: `${bot.systemPrompt}\n${PROGRAMMING_RUN_INSTRUCTIONS}`,
              overrides: {
                model: policy.models.main ?? bot.model,
                // Routing for runs comes from the run policy, not from chat settings.
                routing: undefined,
                ...(decider &&
                  policy.models.fast && {
                    routing: {
                      fastModel: policy.models.fast,
                      minConfidence: policy.models.minConfidence ?? bot.intelligence?.minConfidence ?? 0.85,
                      fallbackAfterMs: policy.models.fallbackAfterMs,
                    },
                  }),
                // Long run threads summarize in the background: cycles never wait for it.
                // Tool schemas load on demand only when the run policy asks and Jev can choose.
                ...((bot.context?.enabled || (decider && policy.context.selectTools)) && {
                  context: {
                    ...bot.context,
                    enabled: true,
                    summaryMode: 'background' as const,
                    selectTools: !!decider && policy.context.selectTools,
                    maxTools: policy.context.maxTools,
                  },
                }),
                contextEvents: (event) => {
                  const runId = event.threadId.startsWith('programming:') ? event.threadId.slice('programming:'.length) : undefined;
                  if (!runId || !programming) return;
                  const type = event.type === 'summary_failed' ? 'summary_discarded' : event.type;
                  programming.journal.record(
                    type,
                    { botId: bot.id, runId, ...(event.traceId && { traceId: event.traceId }) },
                    { reason: event.reason ?? event.type, through: event.through, end: event.end, result: event.type },
                    event.type === 'summary_failed' ? 'failed' : 'info',
                  );
                },
              },
            },
          }),
        agent: {
          apiKey: secrets.apiKey!,
          model: bot.model,
          baseUrl: bot.baseUrl,
          ...(options.fetch && { fetch: options.fetch }),
          ...(bot.context && { context: bot.context }),
          ...(decider && {
            decider,
            ...(bot.intelligence?.fastModel && {
              routing: {
                fastModel: bot.intelligence.fastModel,
                minConfidence: bot.intelligence.minConfidence,
              },
            }),
          }),
          systemPrompt:
            bot.systemPrompt +
            (bot.higgsfield ? HIGGSFIELD_INSTRUCTIONS : '') +
            (bot.programming ? PROGRAMMING_INSTRUCTIONS : '') +
            (programming ? PROGRAMMING_CHAT_INSTRUCTIONS : ''),
          transcription: {
            apiKey: secrets.transcriptionKey,
            baseUrl: bot.transcriptionBaseUrl,
            model: bot.transcriptionModel,
          },
        },
      });
      if (programming && host.programmingAgent) {
        cycles = new AgentCycleExecutor(host.programmingAgent);
        programming.startWorker();
        const close = host.close;
        // Stop executing before the agents go away; runs stay recoverable.
        host.close = async () => {
          try {
            await programming.close();
          } finally {
            await close();
          }
        };
      }
      return host;
    },
    loadConnections: async () => connections,
    channels: { cli: cliChannel, telegram: telegramChannel },
    mcps: { higgsfield: higgsfieldMcp },
  });
}
