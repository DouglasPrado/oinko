import { Agent, createSqlTools } from '@oinko/core';
import { config } from './config.js';
import { createTools } from './tools.js';
import { queries } from './queries.js';
import { pushCampaignSkill } from './skills/push-campaign.js';
import { onboardingSkill } from './skills/onboarding.js';
import { blogContentSkill } from './skills/blog-content.js';
import pg from 'pg';

interface PoolEntry {
  agent: Agent;
  lastUsedAt: number;
}

/** Shared Postgres pool — single connection pool for all agents. */
const pgPool = config.database.url
  ? new pg.Pool({ connectionString: config.database.url, max: 10 })
  : null;

/** Sanitize a string for safe embedding in log messages — strips control chars and ANSI escapes. */
function sanitizeForLog(value: string, maxLen = 40): string {
  return value
    .replace(/[\x00-\x1f\x7f]/g, '_')
    .slice(0, maxLen);
}

/** One agent per conversation — full isolation of state, tools, and memory. */
const pool = new Map<string, PoolEntry>();

/** Conversations currently being initialized — prevents duplicate creation. */
const initializing = new Map<string, Promise<Agent>>();

/** MCP connectivity validated at startup — skip per-agent connect if disabled. */
let mcpValidated: { status: 'enabled' | 'disabled' } | null = null;

/** Cleanup idle agents every 5 minutes. */
const CLEANUP_INTERVAL = 5 * 60_000;

/** Destroy agents idle for more than 30 minutes. */
const IDLE_TTL = 30 * 60_000;

/** Maximum number of concurrent agents — prevents OOM under DoS. */
export let MAX_POOL_SIZE = 500;

/** Nome com que o servidor MCP remoto e registrado. */
const MCP_SERVER_NAME = 'docs';

/**
 * O prompt cobre so o que o SDK nao injeta.
 *
 * Regras de uso de ferramenta chegam por `buildToolUsagePrompt` e a memoria
 * persistente vem do sistema de memoria — repeti-las aqui gastava contexto duas
 * vezes e deixava duas versoes da mesma regra para o modelo conciliar. O que
 * sobra e o que e proprio deste bot: como interpretar pedido de dado em SQL, o
 * estilo de resposta e o formato do Teams.
 */
const SYSTEM_PROMPT = `Voce e o Oinko, um assistente pessoal.

Responda o que foi perguntado, sem preambulo e sem repetir a pergunta de volta.
Nao ofereca o que nao foi pedido: sem "posso tambem mostrar", sem sugestao no
fim. Se a pessoa quiser outra coisa, ela pede.

Prefira o que e verdade ao que soa bem: se nao sabe, diga que nao sabe; se a
ferramenta falhou, diga o que falhou.

Consultas de dados (run_query):
- extraia os parametros da propria frase; nunca peca parametro estruturado
- filtro que a pessoa nao mencionou vai como null
- converta tempo relativo por conta propria: "ultimos 7 dias" vira days_ago=7,
  "ultimo mes" vira 30, "este ano" vira 365; sem periodo, null
- nunca peca data em YYYY-MM-DD

O canal e o Microsoft Teams:
- markdown funciona: negrito, italico, codigo, listas, titulos
- responda no idioma em que a pessoa escreveu`;

/**
 * Returns an isolated Agent for the given conversation.
 * Creates one on first access; subsequent calls return the cached instance.
 */
export async function getAgent(conversationId: string): Promise<Agent> {
  // Return existing agent — move to end to maintain LRU order
  const entry = pool.get(conversationId);
  if (entry) {
    entry.lastUsedAt = Date.now();
    pool.delete(conversationId);
    pool.set(conversationId, entry);
    return entry.agent;
  }

  // Deduplicate concurrent init for the same conversation
  if (initializing.has(conversationId)) {
    return initializing.get(conversationId)!;
  }

  // LRU eviction: Map preserves insertion order; first entry is least-recently-used
  if (pool.size >= MAX_POOL_SIZE) {
    const oldestId = pool.keys().next().value;
    if (oldestId) await destroyAgent(oldestId);
  }

  const promise = createAgent(conversationId);
  initializing.set(conversationId, promise);

  try {
    const agent = await promise;
    pool.set(conversationId, { agent, lastUsedAt: Date.now() });
    return agent;
  } finally {
    initializing.delete(conversationId);
  }
}

async function createAgent(conversationId: string): Promise<Agent> {
  const agent = Agent.create({
    apiKey: config.agent.apiKey,
    baseUrl: config.agent.baseUrl,
    model: config.agent.model,
    systemPrompt: SYSTEM_PROMPT,

    embedding: config.embedding.apiKey || config.embedding.baseUrl ? {
      apiKey: config.embedding.apiKey,
      baseUrl: config.embedding.baseUrl,
      model: config.embedding.model,
    } : undefined,

    memory: {
      enabled: true,
      samplingRate: 0.4,
      extractionInterval: 20,
    },

    knowledge: { enabled: true },

    costPolicy: {
      maxTokensPerExecution: 30_000,
      maxTokensPerSession: 1_000_000,
      onLimitReached: 'warn',
    },

    maxIterations: 20,
    onToolError: 'continue',
    logLevel: 'debug',
    dbPath: './data/agent.db',
  });

  // Register tools — pass agent getter so search_knowledge can reference this instance
  for (const tool of createTools(() => agent, conversationId)) {
    agent.addTool(tool);
  }

  // Register SQL query tools (search_queries + run_query)
  if (pgPool) {
    for (const tool of createSqlTools({ pool: pgPool, queries })) {
      agent.addTool(tool);
    }
  }

  // Connect MCP servers (skip if startup validation already failed)
  if (config.mcp.server.url && mcpValidated?.status !== 'disabled') {
    try {
      await agent.connectMCP({
        name: MCP_SERVER_NAME,
        transport: 'sse',
        url: config.mcp.server.url,
        headers: config.mcp.server.headers,
        timeout: 60_000,
      });
      const health = agent.getHealth();
      const mcpTools = health.servers.find(s => s.name === MCP_SERVER_NAME)?.toolCount ?? 0;
      console.log(`[${sanitizeForLog(conversationId)}] MCP connected — ${mcpTools} tools loaded`);
    } catch (error) {
      console.error(`[${sanitizeForLog(conversationId)}] MCP FAILED — tools will NOT be available:`, error instanceof Error ? error.message : error);
    }
  }

  // Register skills
  agent.addSkill(pushCampaignSkill);
  agent.addSkill(onboardingSkill);
  agent.addSkill(blogContentSkill);

  console.log(`[pool] Agent created for conversation ${sanitizeForLog(conversationId, 20)}... (pool size: ${pool.size + 1})`);
  return agent;
}

/**
 * Destroy a specific conversation's agent.
 */
export async function destroyAgent(conversationId: string): Promise<void> {
  const entry = pool.get(conversationId);
  if (entry) {
    pool.delete(conversationId);
    await entry.agent.destroy();
    console.log(`[pool] Agent destroyed for conversation ${sanitizeForLog(conversationId, 20)}...`);
  }
}

/**
 * Destroy all agents (graceful shutdown).
 */
export async function destroyAll(): Promise<void> {
  const entries = [...pool.entries()];
  pool.clear();
  await Promise.allSettled(entries.map(([id, e]) => {
    console.log(`[pool] Destroying agent ${sanitizeForLog(id, 20)}...`);
    return e.agent.destroy();
  }));
}

/**
 * Validates MCP connectivity at startup.
 * Returns 'enabled' if connection succeeds, 'disabled' with reason otherwise.
 */
export async function validateMCP(): Promise<{ status: 'enabled' | 'disabled'; reason?: string }> {
  if (!config.mcp.server.url) {
    mcpValidated = { status: 'disabled' };
    return { status: 'disabled', reason: 'no URL configured' };
  }

  // Quick probe — create a throwaway agent, attempt MCP connect, then destroy
  const agent = Agent.create({
    apiKey: config.agent.apiKey,
    baseUrl: config.agent.baseUrl,
    model: config.agent.model,
    memory: { enabled: false },
    knowledge: { enabled: false },
    logLevel: 'error',
  });

  try {
    await agent.connectMCP({
      name: MCP_SERVER_NAME,
      transport: 'sse',
      url: config.mcp.server.url,
      headers: config.mcp.server.headers,
      timeout: 10_000,
    });
    await agent.destroy();
    mcpValidated = { status: 'enabled' };
    return { status: 'enabled' };
  } catch (error) {
    await agent.destroy().catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    mcpValidated = { status: 'disabled' };
    return { status: 'disabled', reason: message };
  }
}

/** Pool stats for monitoring. */
export function getPoolStats(): { size: number; maxSize: number; conversationIds: string[] } {
  return { size: pool.size, maxSize: MAX_POOL_SIZE, conversationIds: [...pool.keys()] };
}

/** @internal — test-only: clear pool state and optionally override MAX_POOL_SIZE. */
export function _resetPool(maxPoolSize = 500): void {
  pool.clear();
  initializing.clear();
  MAX_POOL_SIZE = maxPoolSize;
}

// --- Periodic cleanup of idle agents ---
setInterval(async () => {
  const now = Date.now();
  const toRemove: string[] = [];

  for (const [id, entry] of pool) {
    if (now - entry.lastUsedAt > IDLE_TTL) {
      toRemove.push(id);
    }
  }

  for (const id of toRemove) {
    await destroyAgent(id);
    console.log(`[pool] Evicted idle agent ${sanitizeForLog(id, 20)}...`);
  }

  if (toRemove.length > 0) {
    console.log(`[pool] Cleanup: evicted ${toRemove.length}, remaining ${pool.size}`);
  }
}, CLEANUP_INTERVAL).unref();
