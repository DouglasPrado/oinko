import { join } from 'node:path';
import { z } from 'zod';
import type { VectorStore, ConversationStore } from '../contracts/entities/stores.js';
import type { ConversationSearchScope } from '../contracts/entities/conversation-search.js';
import type { Decider } from '../contracts/entities/decider.js';
import type { TelemetrySink } from '../contracts/entities/telemetry.js';
import { isValidTimeZone } from '../utils/local-date.js';

/**
 * Telemetria de execucao.
 *
 * Sem este bloco nada e gravado e o comportamento e identico ao de antes: cada
 * ponto de instrumentacao e um `?.` sobre um sink ausente.
 */
const TelemetryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Destino proprio. Sem isso, um sink SQLite e criado em `dbPath`. */
  sink: z.custom<TelemetrySink>().optional(),
  dbPath: z.string().optional(),
  /** Dias antes da purga. */
  retentionDays: z.number().int().positive().default(30),
  /** Quanto do conteudo chega ao banco. */
  capturePayloads: z.enum(['none', 'hashed', 'full']).default('full'),
  maxPayloadChars: z.number().int().positive().default(32_768),
  /** Rotulo do app host, para separar bots no mesmo banco. */
  app: z.string().optional(),
});

export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;

/** MCP server connection configuration */
const MCPConnectionConfigSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(['stdio', 'sse', 'http', 'auto']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  /** Optional allowlist for stdio commands. When set, only listed commands are permitted. */
  allowedStdioCommands: z.array(z.string()).optional(),
  url: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  /**
   * Cabecalhos resolvidos a cada requisicao, para credencial que expira.
   *
   * Um Bearer fixo em `headers` morre quando o token vence e o servidor passa
   * a responder 401 no meio de um turno. Com isto, quem renova entrega o valor
   * fresco na hora da chamada.
   */
  getHeaders: z.custom<() => Promise<Record<string, string>>>().optional(),
  /**
   * So estas ferramentas sao registradas. Ausente ou vazio, todas entram.
   *
   * Um servidor grande publica dezenas de ferramentas, e o schema de todas
   * viaja em cada chamada de LLM — no Higgsfield sao 101 ferramentas e cerca de
   * 44 mil tokens. Recortar e o que torna um servidor assim utilizavel.
   */
  tools: z.array(z.string()).optional(),
  timeout: z.number().positive().default(30_000),
  maxRetries: z.number().int().min(0).default(3),
  healthCheckInterval: z.number().positive().default(60_000),
  isolateErrors: z.boolean().default(true),
});

/** Cost policy — limits per execution and per session */
const CostPolicySchema = z.object({
  maxTokensPerExecution: z.number().positive().optional(),
  maxTokensPerSession: z.number().positive().optional(),
  maxToolCallsPerExecution: z.number().int().positive().default(50),
  onLimitReached: z.enum(['stop', 'warn']).default('stop'),
});

/** Memory subsystem configuration (file-based) */
const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  memoryDir: z.string().default(() => join(process.cwd(), '.harness', 'memory') + '/'),
  relevanceModel: z.string().optional(),
  maxMemoryFiles: z.number().int().positive().default(200),
  extractionEnabled: z.boolean().default(true),
  samplingRate: z.number().min(0).max(1).default(0.3),
  extractionInterval: z.number().int().positive().default(10),
  /** Confidence floor for a decider verdict on whether a turn is worth remembering. */
  minConfidence: z.number().min(0).max(1).default(0.7),
  /**
   * LGPD sensitive categories (art. 5, II — health, religion, political
   * opinion...) stated by the user. 'omit' keeps them out of memory; 'allow'
   * saves them as stated. CPF, card numbers and credentials are never saved
   * either way — that floor is enforced in code, not by the prompt.
   */
  sensitiveData: z.enum(['omit', 'allow']).default('omit'),
});

/** Knowledge/RAG subsystem configuration */
const KnowledgeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  store: z.custom<VectorStore>().optional(),
  chunkSize: z.number().int().positive().default(512),
  chunkOverlap: z.number().int().min(0).default(64),
  topK: z.number().int().positive().default(5),
  minScore: z.number().min(0).max(1).default(0.3),
  /** Confidence required for a decider to skip retrieval on a turn. */
  minConfidence: z.number().min(0).max(1).default(0.7),
  /** Minimum judged relevance (0..3 scale) to keep a reranked chunk. */
  minRelevance: z.number().min(0).max(3).default(1.5),
});

/** Skills subsystem configuration */
const SkillsConfigSchema = z.object({
  skillsDir: z.string().optional(),
  maxActiveSkills: z.number().int().positive().default(3),
  modelDiscovery: z.boolean().default(true),
});

/** Embedding provider — allows separate API key/URL for embeddings */
const EmbeddingProviderConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  model: z.string().optional(),
});

/** Full Agent configuration — validated with Zod */
export const AgentConfigSchema = z.object({
  apiKey: z.string().min(1, 'apiKey is required'),
  model: z.string().default('anthropic/claude-sonnet-5'),
  baseUrl: z.string().url().default('https://openrouter.ai/api/v1'),
  /**
   * Intercepta as chamadas de chat ao LLM. Recebe uma Request e devolve a
   * Response — qualquer handler com essa assinatura serve, entao da para
   * plugar um gateway in-process, sem porta nem rede:
   *
   * ```ts
   * const handler = async (request: Request) => myGateway.handle(request);
   * Agent.create({ apiKey, fetch: handler });
   * ```
   *
   * Vale so para /chat/completions. Embeddings seguem indo direto ao provedor,
   * porque um gateway de chat nao costuma rotear essa rota.
   *
   * z.custom porque e uma funcao: o Zod nao tem schema nativo para isso e
   * validar a aridade nao acrescentaria garantia real.
   */
  fetch: z
    .custom<(request: Request) => Promise<Response>>((v) => typeof v === 'function')
    .optional(),
  systemPrompt: z.string().optional(),
  /**
   * IANA time zone for the date and time the model is told ("America/Sao_Paulo").
   * Defaults to the host's. UTC would make it tomorrow every evening in Brazil.
   */
  timezone: z.string().refine(isValidTimeZone, 'Unknown IANA time zone').optional(),
  /**
   * Adds a baseline for how to respond (effort proportional to the ask, one
   * clarifying question at most, minimal formatting, faithful reporting).
   * Off by default: the persona belongs to the operator's systemPrompt.
   */
  behaviorPrompt: z.boolean().default(false),

  // Subsystem configs
  memory: MemoryConfigSchema.optional(),
  knowledge: KnowledgeConfigSchema.optional(),
  skills: SkillsConfigSchema.optional(),
  costPolicy: CostPolicySchema.optional(),
  telemetry: TelemetryConfigSchema.optional(),

  // Pluggable stores
  conversation: z
    .object({
      store: z.custom<ConversationStore>().optional(),
      /**
       * Lets the model search earlier messages that fell out of its context
       * (ConversationSearch tool). Off by default: reading old conversations
       * is a new use of personal data, and turning it on is the operator's call.
       * Requires a store that implements `searchMessages` — both built-in ones do.
       */
      search: z
        .object({
          enabled: z.boolean().default(false),
          /** Threads a turn may read, from its own. Default: only its own. */
          scope: z.custom<ConversationSearchScope>((v) => typeof v === 'function').optional(),
          maxResults: z.number().int().min(1).max(10).default(5),
          maxPages: z.number().int().min(1).max(5).default(3),
          snippetChars: z.number().int().min(80).max(600).default(240),
          maxCallsPerTurn: z.number().int().min(1).max(10).default(4),
        })
        .optional(),
    })
    .optional(),

  /**
   * Decision engine for in-loop choices that would otherwise cost a model call
   * or fall back to a blind heuristic. Without it, behaviour is unchanged.
   *
   * z.custom because it is an interface with methods — structural check only.
   */
  decider: z
    .custom<Decider>(
      (v) => typeof v === 'object' && v !== null && typeof (v as Decider).decide === 'function',
    )
    .optional(),

  /**
   * Screens each user message for attempts to get the agent out from under its
   * instructions. Requires a `decider`.
   *
   * 'warn' tells the model what was detected and lets it answer; 'block'
   * refuses the turn without spending an LLM call. Default 'off' — this is
   * moderation policy, which belongs to the consumer, not to the library.
   */
  jailbreak: z
    .object({
      mode: z.enum(['off', 'warn', 'block']).default('off'),
      minConfidence: z.number().min(0).max(1).default(0.75),
      /** Reply sent when a blocked turn is refused. */
      blockedMessage: z
        .string()
        .default('Não posso atender esse pedido. Posso ajudar com outra coisa?'),
    })
    .optional(),

  /**
   * Routes trivial turns to a cheaper model. Requires a `decider`; without
   * one, every turn uses `model` as before.
   */
  routing: z
    .object({
      fastModel: z.string().min(1),
      minConfidence: z.number().min(0).max(1).default(0.7),
    })
    .optional(),

  // MCP
  mcp: z.array(MCPConnectionConfigSchema).optional(),

  // Behavior
  maxIterations: z.number().int().positive().default(10),
  maxConsecutiveErrors: z.number().int().positive().default(3),
  /**
   * Iterations between progress checks when a decider is configured: it
   * judges whether the loop is still getting anywhere, instead of leaving
   * `maxIterations` as the only brake. 0 disables.
   */
  progressCheckInterval: z.number().int().min(0).default(5),
  onToolError: z.enum(['continue', 'stop', 'retry']).default('continue'),

  // Context budget
  maxContextTokens: z.number().int().positive().default(128_000),
  maxPinnedMessages: z.number().int().positive().default(20),
  reserveTokens: z.number().int().min(0).default(4_096),

  // Compaction
  compactionThreshold: z.number().min(0).max(1).default(0.8),

  // Recovery
  fallbackModel: z.string().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  escalatedMaxOutputTokens: z.number().int().positive().optional(),

  // Token budget continuation
  tokenBudget: z
    .object({
      total: z.number().int().positive(),
      outputThreshold: z.number().min(0).max(1).default(0.5),
    })
    .optional(),

  // Observability
  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

  // Determinism (for testing)
  deterministic: z.boolean().default(false),
  seed: z.number().int().optional(),

  // Embedding model (for knowledge/RAG)
  embeddingModel: z.string().default('openai/text-embedding-3-small'),

  // Embedding provider (separate API key/URL for embeddings, e.g. direct OpenAI)
  embedding: EmbeddingProviderConfigSchema.optional(),

  // Transcription model (audio -> texto)
  transcriptionModel: z.string().default('whisper-1'),

  // Transcription provider — o default do SDK e o OpenRouter, que nao serve
  // /audio/transcriptions, entao quem usa audio normalmente aponta para outro
  // provedor, como ja acontece com embeddings.
  transcription: EmbeddingProviderConfigSchema.optional(),

  // Database path
  dbPath: z.string().default(() => join(process.cwd(), '.harness', 'data.db')),
});

/** Input type before validation (allows partial/defaults) */
export type AgentConfigInput = z.input<typeof AgentConfigSchema>;

/** Validated config type */
export type AgentConfig = z.output<typeof AgentConfigSchema>;

export type MCPConnectionConfig = z.output<typeof MCPConnectionConfigSchema>;
export type MCPConnectionConfigInput = z.input<typeof MCPConnectionConfigSchema>;
export type CostPolicy = z.infer<typeof CostPolicySchema>;
