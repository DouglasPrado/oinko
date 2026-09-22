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
  /**
   * Transcricao de nota de voz. O OpenRouter nao serve
   * /audio/transcriptions, entao quem usa audio por la aponta para outro
   * provedor — mesma separacao que ja existe para embeddings.
   */
  transcription: {
    apiKey: process.env.TRANSCRIPTION_API_KEY,
    baseUrl: process.env.TRANSCRIPTION_BASE_URL,
    model: process.env.TRANSCRIPTION_MODEL,
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
  /**
   * Telemetria de execucao.
   *
   * Grava, por turno, o prompt montado, cada chamada de LLM com o custo que o
   * provedor cobrou, as tool calls e os tempos. A dashboard le esse arquivo.
   *
   * Ligada por padrao: o proposito deste exemplo e mostrar o SDK trabalhando,
   * e telemetria desligada nao mostra nada. TELEMETRY=off desliga.
   */
  /**
   * Higgsfield: geracao de imagem e video por MCP.
   *
   * A credencial e obtida na dashboard (fluxo OAuth com browser) e gravada em
   * .harness/credentials/higgsfield.json; aqui so se le e renova. Sem
   * credencial, o bot sobe igual, sem as ferramentas.
   */
  higgsfield: {
    enabled: process.env.HIGGSFIELD !== 'off',
    url: process.env.HIGGSFIELD_MCP_URL ?? 'https://mcp.higgsfield.ai/mcp',
    /**
     * Recorte deliberado das 101 ferramentas que o servidor publica: o schema
     * de todas custaria cerca de 44 mil tokens em cada chamada de LLM.
     */
    tools: (
      process.env.HIGGSFIELD_TOOLS ??
      'generate_image,generate_video,job_status,jobs_wait,models_explore'
    )
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
    /** Geracao e assincrona, mas jobs_wait faz long-poll; 2 min cobre o caso comum. */
    timeoutMs: Number(process.env.HIGGSFIELD_TIMEOUT_MS ?? 120_000),
  },
  telemetry: {
    enabled: process.env.TELEMETRY !== 'off',
    dbPath: process.env.TELEMETRY_DB_PATH ?? './data/telemetry.db',
    retentionDays: Number(process.env.TELEMETRY_RETENTION_DAYS ?? 30),
    /**
     * Conteudo de conversa fica no banco em 'full'. Em producao com dados de
     * terceiro, 'hashed' guarda tamanho e identidade sem o texto.
     */
    capturePayloads: (process.env.TELEMETRY_CAPTURE ?? 'full') as 'none' | 'hashed' | 'full',
  },
};
