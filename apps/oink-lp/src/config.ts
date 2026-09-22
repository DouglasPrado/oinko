import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const schema = z.object({
  HIGGSFIELD: z.enum(['on', 'off']).default('on'),
  HIGGSFIELD_CREDENTIAL_PATH: z
    .string()
    .default(
      fileURLToPath(new URL('../../../.harness/credentials/higgsfield.json', import.meta.url)),
    ),
  HIGGSFIELD_MCP_URL: z.url().default('https://mcp.higgsfield.ai/mcp'),
  HIGGSFIELD_TOOLS: z
    .string()
    .default('generate_image,generate_video,job_status,jobs_wait,models_explore'),
  LLM_API_KEY: z.string().trim().min(1),
  LLM_BASE_URL: z.url().optional(),
  AGENT_MODEL: z.string().trim().min(1),
  AGENT_ID: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .default('oink-lp'),
  AGENT_SYSTEM_PROMPT: z
    .string()
    .min(1)
    .default(
      'Você é o Oink LP, um agente especializado em criar landing pages. Ajude a definir público, oferta, objetivo de conversão, estrutura, textos e design da página. Quando faltar informação essencial, faça perguntas objetivas. Produza código quando solicitado e adapte a solução ao contexto do projeto. Responda no idioma da pessoa, de forma direta e honesta. Nunca afirme ter criado arquivos, executado código ou publicado uma página sem ferramentas e confirmação do resultado.',
    ),
  AGENT_DATA_DIR: z.string().min(1).default('./data'),
  CLI_SESSION_ID: z.string().min(1).default('default'),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_ALLOWED_USER_IDS: z.string().optional(),
  TRANSCRIPTION_API_KEY: z.string().min(1).optional(),
  TRANSCRIPTION_BASE_URL: z.url().optional(),
  TRANSCRIPTION_MODEL: z.string().min(1).optional(),
  TELEMETRY: z.enum(['on', 'off']).default('on'),
  TELEMETRY_DB_PATH: z.string().min(1).optional(),
  TELEMETRY_CAPTURE: z.enum(['none', 'hashed', 'full']).default('full'),
  TELEMETRY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

export function readConfig(env: NodeJS.ProcessEnv, args: string[]) {
  const mode = z.enum(['cli', 'telegram', 'both']).parse(args[0] ?? 'cli');
  if (args.length > 1) throw new Error('Uso: oink-lp [cli|telegram|both]');
  const result = schema.safeParse({
    ...env,
    LLM_BASE_URL: env.LLM_BASE_URL || undefined,
    TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN || undefined,
    TRANSCRIPTION_API_KEY: env.TRANSCRIPTION_API_KEY || undefined,
    TRANSCRIPTION_BASE_URL: env.TRANSCRIPTION_BASE_URL || undefined,
    TRANSCRIPTION_MODEL: env.TRANSCRIPTION_MODEL || undefined,
    TELEMETRY_DB_PATH: env.TELEMETRY_DB_PATH || undefined,
  });
  if (!result.success) {
    // Do not render Zod's input values: these include credentials.
    throw new Error(
      `Configuração inválida: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  const values = result.data;
  const allowedUserIds = (values.TELEGRAM_ALLOWED_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (mode !== 'cli') {
    if (!values.TELEGRAM_BOT_TOKEN) throw new Error('Configure TELEGRAM_BOT_TOKEN.');
    if (!allowedUserIds.length || allowedUserIds.some((id) => !/^[1-9]\d*$/.test(id))) {
      throw new Error(
        'Configure TELEGRAM_ALLOWED_USER_IDS com IDs numéricos separados por vírgulas.',
      );
    }
  }
  return {
    ...values,
    mode,
    allowedUserIds,
    dataDir: resolve(values.AGENT_DATA_DIR, values.AGENT_ID),
    telemetryDbPath: values.TELEMETRY_DB_PATH
      ? resolve(values.TELEMETRY_DB_PATH)
      : resolve(values.AGENT_DATA_DIR, values.AGENT_ID, 'telemetry.db'),
  };
}

export type AppConfig = ReturnType<typeof readConfig>;
