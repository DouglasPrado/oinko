/**
 * Schema do banco de telemetria.
 *
 * Fica num arquivo proprio (`.harness/telemetry.db`), separado do `data.db` do
 * SDK, por tres razoes: uma migration quebrada aqui nao pode derrubar memoria,
 * knowledge e conversas; a telemetria expira em 30 dias e os dados de produto
 * nao, e purgar em massa no mesmo arquivo travaria o unico writer do WAL; e o
 * volume com payload integral e uma a duas ordens de grandeza maior.
 */

export interface TelemetryMigration {
  version: number;
  name: string;
  /** Statements aplicados em ordem, todos dentro de uma transacao. */
  up: readonly string[];
}

const V1_PAYLOADS = [
  // Conteudo enderecado por hash: o system prompt repetido em dez chamadas vira
  // uma linha so, e a listagem mostra "184 KB" sem ler os 184 KB.
  `CREATE TABLE IF NOT EXISTS payloads (
     id          TEXT    PRIMARY KEY,
     size_bytes  INTEGER NOT NULL,
     preview     TEXT    NOT NULL,
     redacted    INTEGER NOT NULL DEFAULT 1,
     body        TEXT    NOT NULL,
     created_at  INTEGER NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS idx_payloads_created ON payloads(created_at)',
];

const V1_EXECUTIONS = [
  `CREATE TABLE IF NOT EXISTS executions (
     trace_id                  TEXT    PRIMARY KEY,
     thread_id                 TEXT    NOT NULL,
     app                       TEXT,
     model                     TEXT    NOT NULL,
     requested_model           TEXT,
     provider_kind             TEXT    NOT NULL,
     system_prompt_payload_id  TEXT,
     tools_schema_payload_id   TEXT,
     tool_def_count            INTEGER,
     user_input_payload_id     TEXT,
     assistant_text_payload_id TEXT,
     context_tokens            INTEGER,
     status                    TEXT    NOT NULL,
     end_reason                TEXT,
     input_tokens              INTEGER NOT NULL DEFAULT 0,
     output_tokens             INTEGER NOT NULL DEFAULT 0,
     total_tokens              INTEGER NOT NULL DEFAULT 0,
     cost_usd                  REAL,
     cost_status               TEXT    NOT NULL DEFAULT 'pending',
     llm_call_count            INTEGER NOT NULL DEFAULT 0,
     tool_call_count           INTEGER NOT NULL DEFAULT 0,
     error_name                TEXT,
     error_message             TEXT,
     error_stack               TEXT,
     started_at                INTEGER NOT NULL,
     ended_at                  INTEGER,
     duration_ms               INTEGER,
     ttft_ms                   INTEGER
   )`,
  'CREATE INDEX IF NOT EXISTS idx_executions_thread ON executions(thread_id, started_at)',
  'CREATE INDEX IF NOT EXISTS idx_executions_started ON executions(started_at)',
];

const V1_LLM_CALLS = [
  `CREATE TABLE IF NOT EXISTS llm_calls (
     id                             TEXT    PRIMARY KEY,
     trace_id                       TEXT    NOT NULL,
     seq                            INTEGER NOT NULL,
     model                          TEXT    NOT NULL,
     provider_name                  TEXT,
     generation_id                  TEXT,
     request_payload_id             TEXT,
     response_payload_id            TEXT,
     response_raw_payload_id        TEXT,
     response_tool_calls_payload_id TEXT,
     finish_reason                  TEXT,
     native_finish_reason           TEXT,
     input_tokens                   INTEGER,
     output_tokens                  INTEGER,
     total_tokens                   INTEGER,
     cached_tokens                  INTEGER,
     cache_write_tokens             INTEGER,
     reasoning_tokens               INTEGER,
     cost_usd                       REAL,
     upstream_cost_usd              REAL,
     cache_discount_usd             REAL,
     cost_status                    TEXT    NOT NULL DEFAULT 'pending',
     cost_source                    TEXT,
     cost_attempts                  INTEGER NOT NULL DEFAULT 0,
     ttft_ms                        INTEGER,
     duration_ms                    INTEGER,
     queued_ms                      INTEGER,
     attempts                       INTEGER,
     streamed                       INTEGER NOT NULL DEFAULT 1,
     cancelled                      INTEGER NOT NULL DEFAULT 0,
     error_name                     TEXT,
     error_message                  TEXT,
     started_at                     INTEGER NOT NULL,
     ended_at                       INTEGER
   )`,
  'CREATE INDEX IF NOT EXISTS idx_llm_calls_trace ON llm_calls(trace_id, seq)',
  'CREATE INDEX IF NOT EXISTS idx_llm_calls_generation ON llm_calls(generation_id)',
  // Parcial: e a fila do enriquecedor de custo, varrida a cada boot.
  `CREATE INDEX IF NOT EXISTS idx_llm_calls_cost_pending ON llm_calls(started_at)
     WHERE cost_status = 'pending' AND generation_id IS NOT NULL`,
];

const V1_INJECTIONS = [
  // Alimenta a barra de composicao do contexto, inclusive os blocos que o
  // orcamento descartou — que e o que responde "por que a skill X nao entrou".
  `CREATE TABLE IF NOT EXISTS llm_call_injections (
     id          TEXT    PRIMARY KEY,
     trace_id    TEXT    NOT NULL,
     llm_call_id TEXT,
     source      TEXT    NOT NULL,
     priority    INTEGER NOT NULL,
     tokens      INTEGER NOT NULL,
     applied     INTEGER NOT NULL,
     payload_id  TEXT,
     created_at  INTEGER NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS idx_injections_trace ON llm_call_injections(trace_id)',
  'CREATE INDEX IF NOT EXISTS idx_injections_source ON llm_call_injections(source, created_at)',
];

const V1_TOOL_CALLS = [
  `CREATE TABLE IF NOT EXISTS tool_calls (
     id                  TEXT    PRIMARY KEY,
     trace_id            TEXT    NOT NULL,
     llm_call_id         TEXT,
     name                TEXT    NOT NULL,
     origin              TEXT    NOT NULL,
     args_payload_id     TEXT,
     result_payload_id   TEXT,
     result_bytes        INTEGER,
     is_error            INTEGER NOT NULL DEFAULT 0,
     truncated           INTEGER NOT NULL DEFAULT 0,
     suspected_injection INTEGER NOT NULL DEFAULT 0,
     metadata_json       TEXT,
     duration_ms         INTEGER NOT NULL,
     started_at          INTEGER NOT NULL,
     ended_at            INTEGER NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS idx_tool_calls_trace ON tool_calls(trace_id, started_at)',
  'CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(name, started_at)',
];

const V1_MCP_CALLS = [
  `CREATE TABLE IF NOT EXISTS mcp_calls (
     id                   TEXT    PRIMARY KEY,
     trace_id             TEXT,
     tool_call_id         TEXT,
     server_name          TEXT    NOT NULL,
     remote_tool_name     TEXT    NOT NULL,
     namespaced_tool_name TEXT    NOT NULL,
     transport            TEXT,
     request_payload_id   TEXT,
     response_payload_id  TEXT,
     content_types        TEXT,
     is_error             INTEGER NOT NULL DEFAULT 0,
     timed_out            INTEGER NOT NULL DEFAULT 0,
     error_message        TEXT,
     duration_ms          INTEGER NOT NULL,
     started_at           INTEGER NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS idx_mcp_calls_trace ON mcp_calls(trace_id, started_at)',
  'CREATE INDEX IF NOT EXISTS idx_mcp_calls_server ON mcp_calls(server_name, started_at)',
];

const V1_DECISIONS = [
  `CREATE TABLE IF NOT EXISTS decisions (
     id             TEXT    PRIMARY KEY,
     trace_id       TEXT,
     thread_id      TEXT,
     point          TEXT    NOT NULL,
     state          TEXT,
     state_hash     TEXT,
     questions_json TEXT    NOT NULL,
     answers_json   TEXT    NOT NULL,
     duration_ms    INTEGER NOT NULL,
     error          TEXT,
     created_at     INTEGER NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS idx_decisions_point ON decisions(point, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_decisions_trace ON decisions(trace_id)',
];

const V1_EVENTS = [
  `CREATE TABLE IF NOT EXISTS events (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     trace_id     TEXT    NOT NULL,
     seq          INTEGER NOT NULL,
     type         TEXT    NOT NULL,
     payload_json TEXT,
     created_at   INTEGER NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id, seq)',
  'CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at)',
];

/**
 * Nenhuma FOREIGN KEY, de proposito: `PRAGMA foreign_keys` e por conexao e vem
 * desligado, entao um ON DELETE CASCADE que nao dispara vira orfao silencioso.
 * Cada tabela filha carrega o proprio timestamp, e a purga nao precisa de JOIN.
 */
export const TELEMETRY_MIGRATIONS: readonly TelemetryMigration[] = [
  {
    version: 1,
    name: 'initial',
    up: [
      ...V1_PAYLOADS,
      ...V1_EXECUTIONS,
      ...V1_LLM_CALLS,
      ...V1_INJECTIONS,
      ...V1_TOOL_CALLS,
      ...V1_MCP_CALLS,
      ...V1_DECISIONS,
      ...V1_EVENTS,
    ],
  },
];
