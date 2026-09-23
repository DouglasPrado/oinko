import 'server-only';
import { telemetryDb } from './telemetry-connection';
import { payloadColumns, payloadJoin, toPayloadRef } from './payload-ref';
import {
  ExecutionDetailSchema,
  type ExecutionDetail,
  type ExecutionSummary,
  type Injection,
  type TimelineItem,
} from '@/features/conversation/schemas/timeline.schema';

type Row = Record<string, unknown>;

const num = (value: unknown): number => Number(value ?? 0);
const nullableNum = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
/**
 * O `node:sqlite` devolve TEXT como string e NULL como null; nada aqui e
 * objeto. As guardas existem para o compilador, nao para o banco.
 */
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const nullableStr = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function toExecution(row: Row): ExecutionSummary {
  return {
    traceId: str(row.trace_id),
    threadId: str(row.thread_id),
    app: nullableStr(row.app),
    model: str(row.model),
    requestedModel: nullableStr(row.requested_model),
    status: str(row.status),
    endReason: nullableStr(row.end_reason),
    inputTokens: num(row.input_tokens),
    outputTokens: num(row.output_tokens),
    totalTokens: num(row.total_tokens),
    costUsd: nullableNum(row.cost_usd),
    costStatus:
      row.cost_status === 'confirmed' || row.cost_status === 'unavailable'
        ? row.cost_status
        : 'pending',
    contextTokens: nullableNum(row.context_tokens),
    startedAt: num(row.started_at),
    durationMs: nullableNum(row.duration_ms),
    ttftMs: nullableNum(row.ttft_ms),
    errorMessage: nullableStr(row.error_message),
  };
}

const EXECUTION_COLUMNS = `trace_id, thread_id, app, model, status, end_reason,
  input_tokens, output_tokens, total_tokens, cost_usd, cost_status, context_tokens,
  started_at, duration_ms, ttft_ms, error_message`;

export function listExecutions(threadId: string, database = telemetryDb()): ExecutionSummary[] {
  const rows = database
    .prepare(
      `SELECT ${EXECUTION_COLUMNS} FROM executions
       WHERE thread_id = ? ORDER BY started_at DESC, trace_id DESC LIMIT 200`,
    )
    .all(threadId) as unknown as Row[];

  return rows.map(toExecution);
}

/**
 * Custo de uma execucao a partir das chamadas que a compoem.
 *
 * Somado aqui e nao lido da coluna da execucao porque o enriquecimento de
 * custo atualiza as chamadas; recalcular por SUM mantem o numero certo mesmo
 * com confirmacao chegando depois.
 */
function rollUpCost(
  traceId: string,
  database = telemetryDb(),
): { costUsd: number | null; costStatus: string } {
  const row = database
    .prepare(
      `SELECT SUM(cost_usd) AS total,
              SUM(CASE WHEN cost_status = 'pending' THEN 1 ELSE 0 END) AS pending,
              COUNT(*) AS n
       FROM llm_calls WHERE trace_id = ?`,
    )
    .get(traceId) as Row | undefined;

  const total = nullableNum(row?.total);
  const pending = num(row?.pending);
  return {
    costUsd: total,
    costStatus: pending > 0 ? 'pending' : total === null ? 'unavailable' : 'confirmed',
  };
}

function llmCalls(traceId: string, database = telemetryDb()): TimelineItem[] {
  const rows = database
    .prepare(
      `SELECT c.id, c.seq, c.model, c.finish_reason, c.input_tokens, c.output_tokens,
              c.cached_tokens, c.cost_usd, c.cost_status, c.cost_source, c.ttft_ms,
              c.duration_ms, c.started_at, c.generation_id, c.provider_name,
              ${payloadColumns('rq', 'request')}, ${payloadColumns('rs', 'response')}
       FROM llm_calls c
       ${payloadJoin('rq', 'request_payload_id', 'c')}
       ${payloadJoin('rs', 'response_payload_id', 'c')}
       WHERE c.trace_id = ? ORDER BY c.seq`,
    )
    .all(traceId) as unknown as Row[];

  return rows.map((row) => ({
    kind: 'llm_call' as const,
    id: str(row.id),
    seq: num(row.seq),
    model: str(row.model),
    finishReason: nullableStr(row.finish_reason),
    inputTokens: nullableNum(row.input_tokens),
    outputTokens: nullableNum(row.output_tokens),
    cachedTokens: nullableNum(row.cached_tokens),
    costUsd: nullableNum(row.cost_usd),
    costStatus:
      row.cost_status === 'confirmed' || row.cost_status === 'unavailable'
        ? row.cost_status
        : 'pending',
    costSource: nullableStr(row.cost_source),
    ttftMs: nullableNum(row.ttft_ms),
    generationId: nullableStr(row.generation_id),
    providerName: nullableStr(row.provider_name),
    startedAt: num(row.started_at),
    durationMs: num(row.duration_ms),
    request: toPayloadRef(row, 'request'),
    response: toPayloadRef(row, 'response'),
  }));
}

function toolCalls(traceId: string, database = telemetryDb()): TimelineItem[] {
  const rows = database
    .prepare(
      `SELECT t.id, t.name, t.origin, t.is_error, t.truncated, t.duration_ms, t.started_at,
              ${payloadColumns('a', 'args')}, ${payloadColumns('r', 'result')}
       FROM tool_calls t
       ${payloadJoin('a', 'args_payload_id', 't')}
       ${payloadJoin('r', 'result_payload_id', 't')}
       WHERE t.trace_id = ? ORDER BY t.started_at`,
    )
    .all(traceId) as unknown as Row[];

  return rows.map((row) => ({
    kind: 'tool_call' as const,
    id: str(row.id),
    name: str(row.name),
    origin: str(row.origin) as 'builtin' | 'skill' | 'mcp' | 'custom',
    isError: num(row.is_error) === 1,
    truncated: num(row.truncated) === 1,
    startedAt: num(row.started_at),
    durationMs: num(row.duration_ms),
    args: toPayloadRef(row, 'args'),
    result: toPayloadRef(row, 'result'),
  }));
}

function mcpCalls(traceId: string, database = telemetryDb()): TimelineItem[] {
  const rows = database
    .prepare(
      `SELECT m.id, m.server_name, m.remote_tool_name, m.is_error, m.timed_out,
              m.duration_ms, m.started_at,
              ${payloadColumns('rq', 'request')}, ${payloadColumns('rs', 'response')}
       FROM mcp_calls m
       ${payloadJoin('rq', 'request_payload_id', 'm')}
       ${payloadJoin('rs', 'response_payload_id', 'm')}
       WHERE m.trace_id = ? ORDER BY m.started_at`,
    )
    .all(traceId) as unknown as Row[];

  return rows.map((row) => ({
    kind: 'mcp_call' as const,
    id: str(row.id),
    serverName: str(row.server_name),
    remoteToolName: str(row.remote_tool_name),
    isError: num(row.is_error) === 1,
    timedOut: num(row.timed_out) === 1,
    startedAt: num(row.started_at),
    durationMs: num(row.duration_ms),
    request: toPayloadRef(row, 'request'),
    response: toPayloadRef(row, 'response'),
  }));
}

function decisions(traceId: string, database = telemetryDb()): TimelineItem[] {
  const rows = database
    .prepare(
      `SELECT id, point, answers_json, duration_ms, created_at
       FROM decisions WHERE trace_id = ? ORDER BY created_at`,
    )
    .all(traceId) as unknown as Row[];

  return rows.map((row) => {
    let answers: Record<string, unknown>;
    try {
      answers = JSON.parse(str(row.answers_json)) as Record<string, unknown>;
    } catch {
      answers = {};
    }
    return {
      kind: 'decision' as const,
      id: str(row.id),
      point: str(row.point),
      answers,
      startedAt: num(row.created_at),
      durationMs: num(row.duration_ms),
    };
  });
}

function injections(traceId: string, database = telemetryDb()): Injection[] {
  const rows = database
    .prepare(
      `SELECT source, tokens, applied FROM llm_call_injections
       WHERE trace_id = ? ORDER BY priority DESC, tokens DESC`,
    )
    .all(traceId) as unknown as Row[];

  return rows.map((row) => ({
    source: str(row.source),
    tokens: num(row.tokens),
    applied: num(row.applied) === 1,
  }));
}

/**
 * Nomes das ferramentas que o modelo tinha a disposicao nesta execucao.
 *
 * Lidos do schema que foi enviado, e nao do registro do agente: o que importa
 * e o que o modelo podia chamar naquele turno, que muda com skill ativada e
 * servidor MCP conectado.
 */
function availableTools(payloadId: string | null, database = telemetryDb()): string[] {
  if (payloadId === null) return [];

  const row = database.prepare('SELECT body FROM payloads WHERE id = ?').get(payloadId) as
    { body: string } | undefined;
  if (!row) return [];

  try {
    const schema = JSON.parse(row.body) as { function?: { name?: string } }[];
    if (!Array.isArray(schema)) return [];
    return schema
      .map((entry) => entry.function?.name)
      .filter((name): name is string => typeof name === 'string');
  } catch {
    return [];
  }
}

export function getExecutionDetail(
  traceId: string,
  database = telemetryDb(),
): ExecutionDetail | undefined {
  const row = database
    .prepare(
      `SELECT ${EXECUTION_COLUMNS},
              ${payloadColumns('sp', 'system')}, ${payloadColumns('ui', 'input')},
              ${payloadColumns('ts', 'tools')}, ${payloadColumns('at', 'assistant')}
       FROM executions e
       ${payloadJoin('sp', 'system_prompt_payload_id', 'e')}
       ${payloadJoin('ui', 'user_input_payload_id', 'e')}
       ${payloadJoin('ts', 'tools_schema_payload_id', 'e')}
       ${payloadJoin('at', 'assistant_text_payload_id', 'e')}
       WHERE e.trace_id = ?`,
    )
    .get(traceId) as Row | undefined;

  if (!row) return undefined;

  const execution = toExecution(row);
  const cost = rollUpCost(traceId, database);

  const items = [
    ...llmCalls(traceId, database),
    ...toolCalls(traceId, database),
    ...mcpCalls(traceId, database),
    ...decisions(traceId, database),
  ].sort((a, b) => a.startedAt - b.startedAt);

  // Validado na fronteira: o schema pertence ao SDK, e uma coluna que mude de
  // forma tem que falhar aqui, com nome, em vez de virar undefined na tela.
  return ExecutionDetailSchema.parse({
    execution: {
      ...execution,
      costUsd: cost.costUsd,
      costStatus: cost.costStatus,
    },
    systemPrompt: toPayloadRef(row, 'system'),
    userInput: toPayloadRef(row, 'input'),
    assistantText: toPayloadRef(row, 'assistant'),
    toolsSchema: toPayloadRef(row, 'tools'),
    availableTools: availableTools(nullableStr(row.tools_id), database),
    injections: injections(traceId, database),
    items,
  });
}
