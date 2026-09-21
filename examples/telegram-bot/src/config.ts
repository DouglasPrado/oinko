import 'dotenv/config';

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`Missing required env var: ${key}`);
    console.error(`Copy .env.example to .env and fill in the values.`);
    process.exit(1);
  }
  return value;
}

export const config = {
  telegram: {
    token: required('TELEGRAM_BOT_TOKEN'),
    adminUserId: process.env.ADMIN_USER_ID ? Number(process.env.ADMIN_USER_ID) : undefined,
  },
  agent: {
    apiKey: required('LLM_API_KEY'),
    baseUrl: process.env.LLM_BASE_URL,
    model: process.env.AGENT_MODEL ?? 'anthropic/claude-sonnet-5',
  },
  embedding: {
    apiKey: process.env.EMBEDDING_API_KEY,
    baseUrl: process.env.EMBEDDING_BASE_URL,
    model: process.env.EMBEDDING_MODEL,
  },
  tavily: {
    apiKey: process.env.TAVILY_API_KEY,
  },
  /**
   * TypeSafe AI (Jev) — decisor tipado para as escolhas internas do agente.
   *
   * Sem a chave o bot roda exatamente como antes: cada ponto de decisao cai na
   * heuristica que ja existia.
   */
  typesafe: {
    apiKey: process.env.TYPESAFE_API_KEY,
    // Onde gravar o log de decisoes para `pnpm analyze:decisions`.
    decisionLog: process.env.DECISION_LOG ?? './data/decisions.jsonl',
    // Modelo barato para turnos triviais. Sem isso, nao ha roteamento.
    fastModel: process.env.FAST_MODEL,
  },
  mcp: {
    albert: {
      url: process.env.MCP_ALBERT_URL,
      headers: process.env.MCP_ALBERT_TOKEN
        ? { 'Authorization': `Bearer ${process.env.MCP_ALBERT_TOKEN}` }
        : undefined,
    },
  },
};
