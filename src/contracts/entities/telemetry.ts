import type { TokenUsage } from './token-usage.js';

/**
 * Estado do custo de uma chamada.
 *
 * `pending` e `unavailable` sao coisas diferentes e a distincao e o que torna
 * o numero confiavel: "ainda nao sei" continua sendo buscado, "nao da para
 * saber" nunca sera preenchido. Custo jamais e estimado.
 */
export type CostStatus = 'pending' | 'confirmed' | 'unavailable';

/** De onde veio o custo confirmado. */
export type CostSource = 'stream_usage' | 'generation_api';

/**
 * Uso por chamada que o `TokenUsage` acumulado nao comporta.
 *
 * Vive separado de propósito: `TokenUsage` e somado com `+=` ao longo do turno
 * e exposto em `agent_end`, `getUsage()` e nos hooks. Um `generationId` dentro
 * de um acumulador nao significaria nada.
 */
export interface LLMUsageDetail {
  /** USD efetivamente cobrado. Ausente quando o provedor nao informa. */
  costUsd?: number;
  upstreamCostUsd?: number;
  cacheDiscountUsd?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  /** Id da geracao no provedor (`gen-…`), chave para confirmar o custo depois. */
  generationId?: string;
  providerName?: string;
  nativeFinishReason?: string;
}

/** Um bloco do prompt montado, com a fonte que o injetou. */
export interface TelemetryInjection {
  source: string;
  priority: number;
  tokens: number;
  /** `false` quando o orcamento de contexto descartou o bloco. */
  applied: boolean;
  content?: string;
}

export interface TelemetryExecutionStart {
  kind: 'execution_start';
  traceId: string;
  threadId: string;
  /** Rotulo do app host, para separar bots no mesmo banco. */
  app?: string;
  model: string;
  requestedModel?: string;
  providerKind: 'openrouter' | 'other';
  systemPrompt?: string;
  toolsSchema?: string;
  toolDefCount?: number;
  userInput?: string;
  injections?: readonly TelemetryInjection[];
  contextTokens?: number;
  startedAt: number;
}

export interface TelemetryExecutionEnd {
  kind: 'execution_end';
  traceId: string;
  status: 'ok' | 'error' | 'aborted';
  endReason?: string;
  assistantText?: string;
  usage?: TokenUsage;
  error?: { name: string; message: string; stack?: string };
  endedAt: number;
  durationMs: number;
  ttftMs?: number;
}

export interface TelemetryLLMCall {
  kind: 'llm_call';
  id: string;
  traceId: string;
  seq: number;
  model: string;
  requestBody?: string;
  responseText?: string;
  responseRaw?: string;
  responseToolCalls?: string;
  finishReason?: string;
  usage?: TokenUsage;
  usageDetail?: LLMUsageDetail;
  costStatus: CostStatus;
  costSource?: CostSource;
  ttftMs?: number;
  durationMs?: number;
  queuedMs?: number;
  attempts?: number;
  streamed: boolean;
  cancelled?: boolean;
  error?: { name: string; message: string };
  startedAt: number;
  endedAt?: number;
}

export interface TelemetryToolCall {
  kind: 'tool_call';
  id: string;
  traceId: string;
  llmCallId?: string;
  name: string;
  origin: 'builtin' | 'skill' | 'mcp' | 'custom';
  args?: string;
  result?: string;
  isError: boolean;
  truncated: boolean;
  suspectedInjection: boolean;
  metadata?: Record<string, unknown>;
  durationMs: number;
  startedAt: number;
  endedAt: number;
}

export interface TelemetryMCPCall {
  kind: 'mcp_call';
  id: string;
  traceId?: string;
  toolCallId?: string;
  serverName: string;
  remoteToolName: string;
  namespacedToolName: string;
  transport?: string;
  request?: string;
  response?: string;
  contentTypes?: string;
  isError: boolean;
  timedOut: boolean;
  errorMessage?: string;
  durationMs: number;
  startedAt: number;
}

/**
 * Uma decisao do decider. Declarada aqui em vez de reusar o `DecisionRecord` de
 * `src/decision/` porque contracts nao importa de infraestrutura; a ponte em
 * `src/telemetry/decision-bridge.ts` faz a conversao.
 */
export interface TelemetryDecision {
  kind: 'decision';
  id: string;
  traceId?: string;
  threadId?: string;
  point: string;
  state?: string;
  stateHash?: string;
  questions: Record<string, { kind: string; instructions: string }>;
  answers: Record<
    string,
    { value: string | number | boolean; confidence: number; probabilities?: Record<string, number> }
  >;
  durationMs: number;
  error?: string;
  createdAt: number;
}

export interface TelemetryAgentEvent {
  kind: 'agent_event';
  traceId: string;
  seq: number;
  /** `AgentEvent['type']`, em snake_case. */
  type: string;
  payload?: Record<string, unknown>;
  createdAt: number;
}

export type TelemetryRecord =
  | TelemetryExecutionStart
  | TelemetryExecutionEnd
  | TelemetryLLMCall
  | TelemetryToolCall
  | TelemetryMCPCall
  | TelemetryDecision
  | TelemetryAgentEvent;

export interface TelemetrySinkStats {
  written: number;
  dropped: number;
}

/**
 * Destino da telemetria.
 *
 * `write` nunca lanca e nunca bloqueia — mesmo contrato do `JsonlSink`. Isto
 * fica atras de instrumentacao, e instrumentacao nao pode derrubar um turno:
 * um registro que nao serializa, ou um disco que recusa a escrita, e contado
 * em `stats()` e descartado.
 */
export interface TelemetrySink {
  write(record: TelemetryRecord): void;
  flush(): Promise<void>;
  close(): Promise<void>;
  stats(): TelemetrySinkStats;
}
