import type { StatementSync } from 'node:sqlite';
import type {
  TelemetryAgentEvent,
  TelemetryDecision,
  TelemetryExecutionEnd,
  TelemetryExecutionStart,
  TelemetryLLMCall,
  TelemetryMCPCall,
  TelemetryRecord,
  TelemetrySink,
  TelemetrySinkStats,
  TelemetryToolCall,
} from '../contracts/entities/telemetry.js';
import { PayloadStore } from './payload-store.js';
import { redactSecrets } from './redact.js';
import type { TelemetryDatabase } from './telemetry-database.js';

type SqlValue = string | number | null;
type Row = Record<string, SqlValue>;

/**
 * Quanto do conteudo chega ao banco.
 *
 * `hashed` guarda tamanho e identidade sem o corpo, para quem precisa medir
 * volume e dedup mas nao pode reter conteudo de usuario.
 */
export type CapturePayloads = 'none' | 'hashed' | 'full';

export interface SqliteTelemetrySinkOptions {
  /** Registros em memoria antes de um flush. Default 200. */
  maxBuffer?: number;
  /** Intervalo do flush automatico em ms. 0 desliga. Default 2000. */
  flushIntervalMs?: number;
  /** Teto por payload, em caracteres. Default 32768. */
  maxPayloadChars?: number;
  /** Segredos literais a raspar — tipicamente a `apiKey` do proprio agente. */
  secrets?: readonly string[];
  capturePayloads?: CapturePayloads;
}

const DEFAULT_MAX_BUFFER = 200;
const DEFAULT_FLUSH_INTERVAL_MS = 2_000;
/** Teto da fila. Alem disso a instrumentacao descarta em vez de crescer sem fim. */
const MAX_QUEUE = 5_000;

function bool(value: boolean | undefined): number {
  return value === true ? 1 : 0;
}

function json(value: unknown): SqlValue {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

/**
 * Grava telemetria em SQLite, fora do caminho do turno.
 *
 * `node:sqlite` e sincrono, entao escrever por registro colocaria a latencia do
 * disco dentro da execucao do agente. Os registros sao enfileirados e drenados
 * em lote, tudo numa transacao — 200 INSERTs custam um fsync, nao duzentos.
 *
 * Nada aqui pode derrubar um turno: `write` nunca lanca, e no flush cada
 * registro e isolado, de modo que um registro malformado e contado e descartado
 * sem levar o lote junto.
 */
export class SqliteTelemetrySink implements TelemetrySink {
  private queue: TelemetryRecord[] = [];
  private written = 0;
  private dropped = 0;
  private closed = false;
  private readonly payloads: PayloadStore;
  private readonly statements = new Map<string, StatementSync>();
  private readonly maxBuffer: number;
  private readonly maxPayloadChars: number;
  private readonly secrets: readonly string[];
  private readonly capture: CapturePayloads;
  private readonly timer?: NodeJS.Timeout;

  constructor(
    private readonly database: TelemetryDatabase,
    options?: SqliteTelemetrySinkOptions,
  ) {
    this.payloads = new PayloadStore(database.db);
    this.maxBuffer = options?.maxBuffer ?? DEFAULT_MAX_BUFFER;
    this.maxPayloadChars = options?.maxPayloadChars ?? 32_768;
    this.secrets = options?.secrets ?? [];
    this.capture = options?.capturePayloads ?? 'full';

    const interval = options?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    if (interval > 0) {
      this.timer = setInterval(() => void this.flush(), interval);
      // Instrumentacao nunca segura o processo aberto.
      this.timer.unref?.();
    }
  }

  write(record: TelemetryRecord): void {
    if (this.closed) return;

    if (this.queue.length >= MAX_QUEUE) {
      this.dropped++;
      return;
    }

    this.queue.push(record);
    if (this.queue.length >= this.maxBuffer) void this.flush();
  }

  flush(): Promise<void> {
    if (this.queue.length === 0) return Promise.resolve();

    const batch = this.queue;
    this.queue = [];

    try {
      this.database.transaction(() => {
        for (const record of batch) {
          try {
            this.persist(record);
            this.written++;
          } catch {
            // Um registro malformado nao pode levar o lote junto.
            this.dropped++;
          }
        }
      });
    } catch {
      this.dropped += batch.length;
    }

    return Promise.resolve();
  }

  close(): Promise<void> {
    const done = this.flush();
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    return done;
  }

  stats(): TelemetrySinkStats {
    return { written: this.written, dropped: this.dropped };
  }

  /**
   * Redige um texto curto que vai direto para uma coluna, sem virar payload.
   *
   * Mensagem de erro de provedor ecoa credencial com frequencia — um 401 da
   * OpenAI responde "Incorrect API key provided: sk-…" com a chave inteira. A
   * coluna de erro precisa da mesma redacao que o payload.
   */
  private scrub(text: string | undefined): SqlValue {
    if (text === undefined) return null;
    return redactSecrets(text, { secrets: this.secrets, maxChars: this.maxPayloadChars });
  }

  /** Guarda o conteudo e devolve a referencia, conforme o modo de captura. */
  private payload(content: string | undefined): SqlValue {
    if (content === undefined || this.capture === 'none') return null;

    const clean = redactSecrets(content, {
      secrets: this.secrets,
      maxChars: this.maxPayloadChars,
    });

    // `hashed` guarda identidade e tamanho reais sem o corpo.
    return this.payloads.put(clean, { storeBody: this.capture === 'full' }).id;
  }

  private exec(sql: string, ...params: SqlValue[]): void {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.database.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    statement.run(...params);
  }

  /**
   * INSERT montado a partir das chaves da linha.
   *
   * Sete blocos de INSERT escritos a mao seriam quase identicos e cairiam no
   * jscpd; o statement e cacheado por tabela e conjunto de colunas.
   */
  private insert(table: string, row: Row): void {
    const columns = Object.keys(row);
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns
      .map(() => '?')
      .join(', ')})`;
    this.exec(sql, ...columns.map((column) => row[column] ?? null));
  }

  private persist(record: TelemetryRecord): void {
    switch (record.kind) {
      case 'execution_start':
        return this.persistExecutionStart(record);
      case 'execution_end':
        return this.persistExecutionEnd(record);
      case 'llm_call':
        return this.persistLLMCall(record);
      case 'tool_call':
        return this.persistToolCall(record);
      case 'mcp_call':
        return this.persistMCPCall(record);
      case 'decision':
        return this.persistDecision(record);
      case 'agent_event':
        return this.persistAgentEvent(record);
      default:
        throw new Error(`unknown telemetry record: ${JSON.stringify(record)}`);
    }
  }

  private persistExecutionStart(record: TelemetryExecutionStart): void {
    this.insert('executions', {
      trace_id: record.traceId,
      thread_id: record.threadId,
      app: record.app ?? null,
      correlation_json: record.correlation ? JSON.stringify(record.correlation) : null,
      model: record.model,
      requested_model: record.requestedModel ?? null,
      provider_kind: record.providerKind,
      system_prompt_payload_id: this.payload(record.systemPrompt),
      tools_schema_payload_id: this.payload(record.toolsSchema),
      tool_def_count: record.toolDefCount ?? null,
      user_input_payload_id: this.payload(record.userInput),
      context_tokens: record.contextTokens ?? null,
      status: 'running',
      started_at: record.startedAt,
    });

    for (const [index, injection] of (record.injections ?? []).entries()) {
      this.insert('llm_call_injections', {
        id: `${record.traceId}:${index}`,
        trace_id: record.traceId,
        llm_call_id: null,
        source: injection.source,
        priority: injection.priority,
        tokens: injection.tokens,
        applied: bool(injection.applied),
        payload_id: this.payload(injection.content),
        created_at: record.startedAt,
      });
    }
  }

  private persistExecutionEnd(record: TelemetryExecutionEnd): void {
    this.exec(
      `UPDATE executions SET
         status = ?, end_reason = ?, assistant_text_payload_id = ?,
         input_tokens = ?, output_tokens = ?, total_tokens = ?,
         error_name = ?, error_message = ?, error_stack = ?,
         ended_at = ?, duration_ms = ?, ttft_ms = ?
       WHERE trace_id = ?`,
      record.status,
      record.endReason ?? null,
      this.payload(record.assistantText),
      record.usage?.inputTokens ?? 0,
      record.usage?.outputTokens ?? 0,
      record.usage?.totalTokens ?? 0,
      record.error?.name ?? null,
      this.scrub(record.error?.message),
      this.scrub(record.error?.stack),
      record.endedAt,
      record.durationMs,
      record.ttftMs ?? null,
      record.traceId,
    );

    this.rollUp(record.traceId);
  }

  /**
   * Consolida custo e contagens na linha da execucao.
   *
   * Feito por SUM sobre as chamadas, nunca acumulado a cada insercao: assim um
   * enriquecimento de custo que chegue depois — ou duas vezes — nao dobra a
   * fatura. `pending` em qualquer chamada mantem a execucao pendente, e soma
   * nula vira `unavailable` em vez de zero.
   */
  private rollUp(traceId: string): void {
    this.exec(
      `UPDATE executions SET
         cost_usd = (SELECT SUM(cost_usd) FROM llm_calls WHERE trace_id = ?1),
         cost_status = CASE
           WHEN EXISTS (SELECT 1 FROM llm_calls WHERE trace_id = ?1 AND cost_status = 'pending')
             THEN 'pending'
           WHEN (SELECT SUM(cost_usd) FROM llm_calls WHERE trace_id = ?1) IS NULL
             THEN 'unavailable'
           ELSE 'confirmed'
         END,
         llm_call_count = (SELECT COUNT(*) FROM llm_calls WHERE trace_id = ?1),
         tool_call_count = (SELECT COUNT(*) FROM tool_calls WHERE trace_id = ?1)
       WHERE trace_id = ?1`,
      traceId,
    );
  }

  private persistLLMCall(record: TelemetryLLMCall): void {
    const detail = record.usageDetail;

    this.insert('llm_calls', {
      id: record.id,
      trace_id: record.traceId,
      seq: record.seq,
      model: record.model,
      provider_name: detail?.providerName ?? null,
      generation_id: detail?.generationId ?? null,
      request_payload_id: this.payload(record.requestBody),
      response_payload_id: this.payload(record.responseText),
      response_raw_payload_id: this.payload(record.responseRaw),
      response_tool_calls_payload_id: this.payload(record.responseToolCalls),
      finish_reason: record.finishReason ?? null,
      native_finish_reason: detail?.nativeFinishReason ?? null,
      input_tokens: record.usage?.inputTokens ?? null,
      output_tokens: record.usage?.outputTokens ?? null,
      total_tokens: record.usage?.totalTokens ?? null,
      cached_tokens: detail?.cachedTokens ?? null,
      cache_write_tokens: detail?.cacheWriteTokens ?? null,
      reasoning_tokens: detail?.reasoningTokens ?? null,
      // Ausente fica NULL, nunca 0: "custo desconhecido" e "custou nada" sao
      // coisas diferentes, e confundi-las corrompe todo relatorio de custo.
      cost_usd: detail?.costUsd ?? null,
      upstream_cost_usd: detail?.upstreamCostUsd ?? null,
      cache_discount_usd: detail?.cacheDiscountUsd ?? null,
      cost_status: record.costStatus,
      cost_source: record.costSource ?? null,
      ttft_ms: record.ttftMs ?? null,
      duration_ms: record.durationMs ?? null,
      queued_ms: record.queuedMs ?? null,
      attempts: record.attempts ?? null,
      streamed: bool(record.streamed),
      cancelled: bool(record.cancelled),
      error_name: record.error?.name ?? null,
      error_message: this.scrub(record.error?.message),
      started_at: record.startedAt,
      ended_at: record.endedAt ?? null,
    });
  }

  private persistToolCall(record: TelemetryToolCall): void {
    this.insert('tool_calls', {
      id: record.id,
      trace_id: record.traceId,
      llm_call_id: record.llmCallId ?? null,
      name: record.name,
      origin: record.origin,
      args_payload_id: this.payload(record.args),
      result_payload_id: this.payload(record.result),
      result_bytes: record.result === undefined ? null : Buffer.byteLength(record.result, 'utf8'),
      is_error: bool(record.isError),
      truncated: bool(record.truncated),
      suspected_injection: bool(record.suspectedInjection),
      metadata_json: json(record.metadata),
      duration_ms: record.durationMs,
      started_at: record.startedAt,
      ended_at: record.endedAt,
    });
  }

  private persistMCPCall(record: TelemetryMCPCall): void {
    this.insert('mcp_calls', {
      id: record.id,
      trace_id: record.traceId ?? null,
      tool_call_id: record.toolCallId ?? null,
      server_name: record.serverName,
      remote_tool_name: record.remoteToolName,
      namespaced_tool_name: record.namespacedToolName,
      transport: record.transport ?? null,
      request_payload_id: this.payload(record.request),
      response_payload_id: this.payload(record.response),
      content_types: record.contentTypes ?? null,
      is_error: bool(record.isError),
      timed_out: bool(record.timedOut),
      error_message: this.scrub(record.errorMessage),
      duration_ms: record.durationMs,
      started_at: record.startedAt,
    });
  }

  private persistDecision(record: TelemetryDecision): void {
    this.insert('decisions', {
      id: record.id,
      trace_id: record.traceId ?? null,
      thread_id: record.threadId ?? null,
      point: record.point,
      state:
        record.state === undefined ? null : redactSecrets(record.state, { secrets: this.secrets }),
      state_hash: record.stateHash ?? null,
      questions_json: json(record.questions) ?? '{}',
      answers_json: json(record.answers) ?? '{}',
      duration_ms: record.durationMs,
      input_tokens: record.usage?.inputTokens ?? null,
      output_tokens: record.usage?.outputTokens ?? null,
      error: this.scrub(record.error),
      created_at: record.createdAt,
    });
  }

  private persistAgentEvent(record: TelemetryAgentEvent): void {
    this.insert('events', {
      trace_id: record.traceId,
      seq: record.seq,
      type: record.type,
      payload_json: json(record.payload),
      created_at: record.createdAt,
    });
  }
}
