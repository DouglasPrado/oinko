import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
import { parseConnections } from '@oinko/agent-runtime/connections';
import { BotError } from './schema.js';
import type { BotStore } from './store.js';

/** One-time import. Existing records always win; original files and data stay in place. */
export function importOinkLp(store: BotStore): string | undefined {
  const directory = join(store.root, 'apps/oink-lp');
  const file = join(directory, '.env');
  if (!existsSync(file)) return undefined;
  const env = parseEnv(readFileSync(file, 'utf8'));
  const id = env.AGENT_ID || 'oink-lp';
  if (store.has(id)) return id;
  if (!env.AGENT_MODEL || !env.LLM_API_KEY) return undefined;
  const dataDir = resolve(directory, env.AGENT_DATA_DIR || './data', id);
  const credentialPath = resolve(
    directory,
    env.HIGGSFIELD_CREDENTIAL_PATH || '../../.harness/credentials/higgsfield.json',
  );
  const connectionsFile = resolve(directory, env.AGENT_CONNECTIONS_FILE || 'connections.json');
  const connections = existsSync(connectionsFile)
    ? parseConnections(JSON.parse(readFileSync(connectionsFile, 'utf8')), {
        ...env,
        HIGGSFIELD_CREDENTIAL_PATH: credentialPath,
        HIGGSFIELD_MCP_URL: env.HIGGSFIELD_MCP_URL || 'https://mcp.higgsfield.ai/mcp',
        HIGGSFIELD_TOOLS:
          env.HIGGSFIELD_TOOLS ||
          'generate_image,generate_video,job_status,jobs_wait,models_explore',
      })
    : { channels: [], mcps: [] };
  if (
    connections.channels.some((entry) => !['cli', 'telegram'].includes(entry.type)) ||
    connections.mcps.some((entry) => entry.type !== 'higgsfield')
  )
    throw new BotError(
      'A configuração anterior usa conexões personalizadas. Importe-as explicitamente antes de substituir o executor.',
    );
  const cli = connections.channels.find((entry) => entry.type === 'cli');
  const telegram = connections.channels.find((entry) => entry.type === 'telegram');
  const higgsfield = connections.mcps.find((entry) => entry.type === 'higgsfield');
  store.save(
    {
      id,
      name: 'Oink LP',
      model: env.AGENT_MODEL,
      systemPrompt:
        env.AGENT_SYSTEM_PROMPT ||
        'Você é o Oink LP, um agente especializado em criar landing pages. Ajude a definir público, oferta, objetivo de conversão, estrutura, textos e design da página. Quando faltar informação essencial, faça perguntas objetivas. Produza código quando solicitado e adapte a solução ao contexto do projeto. Responda no idioma da pessoa, de forma direta e honesta. Nunca afirme ter criado arquivos, executado código ou publicado uma página sem ferramentas e confirmação do resultado.',
      baseUrl: env.LLM_BASE_URL || undefined,
      cli: cli?.enabled ?? true,
      telegram: {
        enabled: telegram?.enabled ?? Boolean(env.TELEGRAM_BOT_TOKEN),
        allowedUserIds:
          telegram?.options.allowedUserIds ??
          (env.TELEGRAM_ALLOWED_USER_IDS || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
      },
      higgsfield: env.HIGGSFIELD !== 'off' && (higgsfield?.enabled ?? true),
      higgsfieldUrl: higgsfield?.options.url,
      higgsfieldTools: higgsfield?.options.tools,
      mcps: [],
      telemetry: {
        enabled: env.TELEMETRY !== 'off',
        capture: env.TELEMETRY_CAPTURE || 'full',
        retentionDays: Number(env.TELEMETRY_RETENTION_DAYS || 30),
      },
      transcriptionModel: env.TRANSCRIPTION_MODEL || undefined,
      transcriptionBaseUrl: env.TRANSCRIPTION_BASE_URL || undefined,
    },
    {
      apiKey: env.LLM_API_KEY,
      telegramToken: telegram?.options.token ?? env.TELEGRAM_BOT_TOKEN,
      transcriptionKey: env.TRANSCRIPTION_API_KEY,
    },
    0,
    {
      dataDir,
      higgsfieldCredentialPath: credentialPath,
      telemetryDbPath: env.TELEMETRY_DB_PATH
        ? resolve(directory, env.TELEMETRY_DB_PATH)
        : join(dataDir, 'telemetry.db'),
    },
  );
  return id;
}
