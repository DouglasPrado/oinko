import type { LLMClient } from '../llm/llm-client.js';
import type { ToolExecutor } from '../tools/tool-executor.js';
import type { LLMMessage } from '../llm/message-types.js';
import type { TokenUsage } from '../contracts/entities/token-usage.js';
import type { LLMUsageDetail } from '../contracts/entities/telemetry.js';
import type { AgentEvent, RecoveryReason } from '../contracts/entities/agent-event.js';
import type { OnToolError } from '../contracts/enums/index.js';
import type { Terminal, LoopState } from './loop-types.js';
import type { StopHook } from './stop-hooks.js';
import type { LoopDeps } from './loop-deps.js';
import { createInitialState } from './loop-types.js';
import { StreamingToolExecutor } from './streaming-tool-executor.js';
import { microcompact } from './compaction/microcompact.js';
import { applyToolResultBudget } from './compaction/tool-result-budget.js';
import { snipCompact } from './compaction/snip-compact.js';
import { autocompact } from './compaction/autocompact.js';
import { runStopHooks } from './stop-hooks.js';
import { isLoopProductive } from './progress-gate.js';
import type { Decider } from '../contracts/entities/decider.js';
import type { Logger } from '../utils/logger.js';
import {
  PromptTooLongError,
  OverloadedError,
  InsufficientCreditsError,
  classifyAPIError,
} from '../llm/errors.js';
import { SKILL_TOOL_NAME } from '../tools/skill-tool.js';
import { normalizeMessagesForAPI } from './message-normalize.js';

const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3;
const MAX_BUDGET_CONTINUATIONS = 4;
const MIN_DELTA_TOKENS = 50;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 10_000;
const DEFAULT_COMPACTION_THRESHOLD = 0.8;
const DEFAULT_TAIL_PROTECTION = 4;

export interface TokenBudgetConfig {
  total: number;
  outputThreshold: number; // 0.0-1.0 — continue if output below this ratio of total
}

export interface ReactLoopConfig {
  client: LLMClient;
  toolExecutor: ToolExecutor;
  model: string;
  maxIterations: number;
  maxConsecutiveErrors: number;
  onToolError: OnToolError;
  costPolicy?: {
    maxTokensPerExecution?: number;
    onLimitReached: 'stop' | 'warn';
  };
  signal?: AbortSignal;
  // Phase 2: Compaction & Recovery
  maxContextTokens?: number;
  compactionThreshold?: number;
  fallbackModel?: string;
  maxOutputTokens?: number;
  escalatedMaxOutputTokens?: number;
  // Phase 3: Stop hooks, DI, Token budget
  stopHooks?: StopHook[];
  deps?: Partial<LoopDeps>;
  tokenBudget?: TokenBudgetConfig;
  /** Judges whether the loop is still getting anywhere. Without it, only maxIterations stops it. */
  decider?: Decider;
  /** Iterations between progress checks. Default 5; 0 disables. */
  progressCheckInterval?: number;
  logger?: Logger;
  // Phase 4: Tool intelligence
  /** Called after tool execution with file paths extracted from tool results.
   *  Returns newly activated skill names (e.g., for conditional skill activation). */
  onFilePathsTouched?: (paths: string[]) => string[];
  /**
   * Chamado ao fim de cada chamada de LLM, com o custo real e os tempos que so
   * existem aqui. Nunca lanca para o loop: erro de instrumentacao nao pode
   * derrubar um turno.
   */
  onLLMCall?: (call: LLMCallTelemetry) => void;
  /** Execucao corrente. Repassada as tools para correlacionar telemetria. */
  traceId?: string;
  /** Conversa corrente. Repassada as tools que guardam estado por conversa. */
  threadId?: string;
  /** Inicio do turno (epoch ms). Repassado as tools que leem o historico. */
  turnStartedAt?: number;
}

/** O que uma chamada de LLM deixa para a telemetria. */
export interface LLMCallTelemetry {
  seq: number;
  model: string;
  finishReason: string;
  usage?: TokenUsage;
  usageDetail?: LLMUsageDetail;
  ttftMs?: number;
  durationMs?: number;
  queuedMs?: number;
  attempts?: number;
  startedAt: number;
  endedAt: number;
  responseText: string;
  /**
   * Mensagens exatamente como foram enviadas nesta iteracao.
   *
   * Muda a cada volta do loop — a segunda chamada carrega o resultado da tool
   * que a primeira pediu —, e e isso que responde "o que o modelo viu quando
   * decidiu isso". O prompt guardado na execucao so cobre a primeira.
   */
  requestMessages: readonly LLMMessage[];
  /** Tool calls que o modelo pediu nesta chamada, em JSON. */
  responseToolCalls?: string;
}

/**
 * ReAct loop as AsyncGenerator.
 * Yields AgentEvent, returns Terminal.
 * State is immutable — replaced atomically at each continue site.
 */
export async function* executeReactLoop(
  initialMessages: LLMMessage[],
  config: ReactLoopConfig,
): AsyncGenerator<AgentEvent, Terminal> {
  const {
    client,
    toolExecutor,
    maxIterations,
    decider,
    progressCheckInterval: progressInterval = 5,
    logger,
    maxConsecutiveErrors,
    onToolError,
    costPolicy,
    signal,
    maxContextTokens,
    compactionThreshold,
    fallbackModel,
    maxOutputTokens,
    escalatedMaxOutputTokens,
    stopHooks,
    deps,
    tokenBudget,
  } = config;

  let currentModel = config.model;
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const toolDefs =
    toolExecutor.listTools().length > 0 ? toolExecutor.getToolDefinitions() : undefined;

  // DI: use injected callModel or default to client.streamChat
  const callModel = deps?.callModel ?? ((params) => client.streamChat(params));

  // Token budget continuation tracking
  let budgetContinuationCount = 0;
  let cumulativeOutputTokens = 0;
  let costWarningEmitted = false;

  let state: LoopState = createInitialState([...initialMessages]);

  while (true) {
    const { turnCount, consecutiveErrors } = state;
    // Rebound when autocompact succeeds, so every later iteration builds on
    // the summary instead of summarizing the same history all over again.
    let messages = state.messages;

    // --- Check abort ---
    if (signal?.aborted) {
      return { reason: 'abort', usage };
    }

    // --- Check cost policy ---
    if (
      costPolicy?.maxTokensPerExecution &&
      usage.totalTokens >= costPolicy.maxTokensPerExecution
    ) {
      if (costPolicy.onLimitReached === 'stop') {
        return { reason: 'cost_limit', usage };
      }
      if (!costWarningEmitted) {
        yield { type: 'warning', message: 'Token limit approaching', code: 'cost_warning' };
        costWarningEmitted = true;
      }
    }

    // --- Check max iterations ---
    if (turnCount > maxIterations) {
      yield { type: 'warning', message: 'Max iterations reached', code: 'max_iterations' };
      return { reason: 'max_iterations', usage };
    }

    // --- Progress check ---
    // Only every few iterations: this is a network round trip, and a loop
    // needs a couple of turns before repetition is even visible.
    if (
      decider &&
      progressInterval > 0 &&
      turnCount > progressInterval &&
      (turnCount - 1) % progressInterval === 0
    ) {
      const productive = await isLoopProductive(messages, turnCount - 1, decider, {
        ...(config.signal !== undefined && { signal: config.signal }),
        ...(logger !== undefined && { logger }),
      });
      if (!productive) {
        yield {
          type: 'warning',
          message: 'Loop stopped early: the last turns repeated without progress',
          code: 'no_progress',
        };
        return { reason: 'max_iterations', usage };
      }
    }

    // --- Compaction pipeline (before LLM call) ---
    let compactedMessages = [...messages] as LLMMessage[];

    // 0. Tool result budget — aggregate truncation (largest first)
    if (maxContextTokens) {
      const budgetChars = Math.floor(maxContextTokens * 4 * 0.5); // 50% of context in chars
      const budgetResult = applyToolResultBudget(compactedMessages, {
        maxTotalToolResultChars: budgetChars,
      });
      if (budgetResult.truncatedCount > 0) {
        compactedMessages = budgetResult.messages;
      }
    }

    // 0.5. Snip compact — remove orphaned early tool results
    const snipResult = snipCompact(compactedMessages, { tailProtection: DEFAULT_TAIL_PROTECTION });
    if (snipResult.snippedCount > 0) {
      compactedMessages = snipResult.messages;
    }

    // 1. Microcompact — truncate large tool results (with per-tool overrides)
    const perToolMaxChars = new Map<string, number>();
    for (const tool of toolExecutor.listTools()) {
      if (tool.maxResultChars !== undefined) {
        perToolMaxChars.set(tool.name, tool.maxResultChars);
      }
    }
    // Build tool_call_id → tool_name map from assistant messages in history
    const toolCallIdToName = new Map<string, string>();
    for (const msg of compactedMessages) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolCallIdToName.set(tc.id, tc.function.name);
        }
      }
    }
    const microResult = microcompact(compactedMessages, {
      maxToolResultChars: DEFAULT_MAX_TOOL_RESULT_CHARS,
      perToolMaxChars: perToolMaxChars.size > 0 ? perToolMaxChars : undefined,
      toolCallIdToName: toolCallIdToName.size > 0 ? toolCallIdToName : undefined,
    });
    if (microResult.truncatedCount > 0) {
      compactedMessages = microResult.messages;
      yield { type: 'compaction', strategy: 'microcompact', tokensFreed: 0 };
    }

    // 2. Autocompact — summarize if threshold exceeded
    if (maxContextTokens) {
      const autoResult = await autocompact(compactedMessages, client, {
        maxContextTokens,
        compactionThreshold: compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD,
        tailProtection: DEFAULT_TAIL_PROTECTION,
      });
      if (autoResult) {
        compactedMessages = autoResult.messages;
        messages = autoResult.messages;
        yield { type: 'compaction', strategy: 'autocompact', tokensFreed: autoResult.tokensFreed };
      }
    }

    // --- Turn start ---
    yield { type: 'turn_start', iteration: turnCount - 1 };

    let fullText = '';
    let finishReason = '';
    let turnOutputTokens = 0;
    const callStartedAt = Date.now();
    const toolCalls: { id: string; name: string; arguments: string }[] = [];
    const earlyToolResults: LLMMessage[] = []; // Tool results completed during streaming

    // --- Stream from LLM ---
    const streamingExecutor = new StreamingToolExecutor(
      toolExecutor,
      signal,
      undefined,
      messages.length,
      config.traceId,
      config.threadId,
      config.turnStartedAt,
    );
    const effectiveMaxTokens = state.maxOutputTokensOverride ?? maxOutputTokens;

    try {
      // Normalize messages before API call (remove orphaned tool results/calls, empty messages)
      const normalizedMessages = normalizeMessagesForAPI(compactedMessages);

      for await (const chunk of callModel({
        messages: normalizedMessages,
        tools: toolDefs,
        model: currentModel,
        signal,
        maxTokens: effectiveMaxTokens,
      })) {
        switch (chunk.type) {
          case 'content':
            fullText += chunk.data;
            yield { type: 'text_delta', content: chunk.data };
            break;
          case 'tool_call':
            toolCalls.push({ id: chunk.id, name: chunk.name, arguments: chunk.arguments });
            yield {
              type: 'tool_call_start',
              toolCall: {
                id: chunk.id,
                type: 'function',
                function: { name: chunk.name, arguments: chunk.arguments },
              },
            };
            streamingExecutor.addTool(chunk.id, chunk.name, chunk.arguments);
            break;
          case 'done':
            finishReason = chunk.finishReason;
            if (chunk.usage) {
              usage.inputTokens += chunk.usage.inputTokens;
              usage.outputTokens += chunk.usage.outputTokens;
              usage.totalTokens += chunk.usage.totalTokens;
              turnOutputTokens = chunk.usage.outputTokens;
            }
            if (config.onLLMCall) {
              try {
                config.onLLMCall({
                  seq: turnCount - 1,
                  model: currentModel,
                  finishReason: chunk.finishReason,
                  usage: chunk.usage,
                  usageDetail: chunk.usageDetail,
                  ttftMs: chunk.ttftMs,
                  durationMs: chunk.durationMs,
                  queuedMs: chunk.queuedMs,
                  attempts: chunk.attempts,
                  startedAt: callStartedAt,
                  endedAt: Date.now(),
                  responseText: fullText,
                  requestMessages: normalizedMessages,
                  ...(toolCalls.length > 0 && {
                    responseToolCalls: JSON.stringify(toolCalls),
                  }),
                });
              } catch {
                // Instrumentacao nunca derruba o turno.
              }
            }
            break;
        }

        // Yield progress events from tools executing during streaming
        for (const progress of streamingExecutor.getProgressEvents()) {
          yield {
            type: 'tool_progress',
            toolCallId: progress.toolCallId,
            toolName: progress.toolName,
            data: progress.data,
          };
        }

        // Yield completed tool results during streaming and collect for message history
        for (const completed of streamingExecutor.getCompletedResults()) {
          yield {
            type: 'tool_call_end',
            toolCallId: completed.id,
            result: completed.result,
            duration: completed.duration,
          };
          earlyToolResults.push({
            role: 'tool',
            content: completed.result.content,
            tool_call_id: completed.id,
          });
          if (completed.result.isError && onToolError === 'stop') {
            yield { type: 'turn_end', iteration: turnCount - 1, hasToolCalls: true };
            return { reason: 'error', usage };
          }
        }
      }

      // --- Build assistant message ---
      const assistantMessage: LLMMessage = { role: 'assistant', content: fullText };
      if (toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }

      // --- Max Output Tokens Recovery (two steps: escalate first, then resume) ---
      if (finishReason === 'length' && toolCalls.length === 0) {
        // Step 1: Escalate maxTokens (retry same request with higher limit)
        if (escalatedMaxOutputTokens && state.maxOutputTokensOverride === undefined) {
          yield { type: 'recovery', reason: 'max_output_tokens_escalate', attempt: 1 };

          state = {
            ...state,
            maxOutputTokensOverride: escalatedMaxOutputTokens,
            transition: { reason: 'max_output_tokens_escalate' },
          };
          continue;
        }

        // Step 2: Multi-turn recovery (inject resume message)
        const recoveryCount = state.maxOutputTokensRecoveryCount + 1;

        if (recoveryCount > MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
          if (fullText) yield { type: 'text_done', content: fullText };
          yield { type: 'turn_end', iteration: turnCount - 1, hasToolCalls: false };
          return { reason: 'max_output_tokens', usage };
        }

        yield { type: 'recovery', reason: 'max_output_tokens_recovery', attempt: recoveryCount };

        const resumeMessage: LLMMessage = {
          role: 'user',
          content:
            '[System: Your response was truncated. Resume directly from where you stopped — no recap, no repetition.]',
        };

        state = {
          ...state,
          messages: [...messages, assistantMessage, resumeMessage],
          maxOutputTokensRecoveryCount: recoveryCount,
          transition: { reason: 'max_output_tokens_recovery' },
        };
        continue;
      }

      // --- No tool calls → check stop hooks + budget continuation ---
      if (toolCalls.length === 0) {
        // Run stop hooks (if any)
        if (stopHooks && stopHooks.length > 0) {
          const hookResult = await runStopHooks(stopHooks, {
            messages,
            assistantText: fullText,
            turnCount,
          });

          if (hookResult.preventContinuation) {
            if (fullText) yield { type: 'text_done', content: fullText };
            yield { type: 'turn_end', iteration: turnCount - 1, hasToolCalls: false };
            return { reason: 'stop_hook', usage };
          }

          if (hookResult.blockingErrors.length > 0) {
            const stopHookRetryCount = state.stopHookRetryCount + 1;
            yield { type: 'recovery', reason: 'stop_hook_blocking', attempt: stopHookRetryCount };

            const errorMessages: LLMMessage[] = hookResult.blockingErrors.map((err) => ({
              role: 'user' as const,
              content: `[Stop hook error: ${err}]`,
            }));

            state = {
              ...state,
              messages: [...messages, assistantMessage, ...errorMessages],
              turnCount: turnCount + 1,
              stopHookRetryCount,
              transition: { reason: 'stop_hook_blocking' },
            };
            continue;
          }
        }

        // Token budget continuation
        if (tokenBudget) {
          cumulativeOutputTokens += turnOutputTokens;
          const outputThreshold = tokenBudget.total * tokenBudget.outputThreshold;
          const belowThreshold = cumulativeOutputTokens < outputThreshold;
          const notExhausted = budgetContinuationCount < MAX_BUDGET_CONTINUATIONS;
          const notDiminishing =
            turnOutputTokens >= MIN_DELTA_TOKENS || budgetContinuationCount === 0;

          if (belowThreshold && notExhausted && notDiminishing) {
            budgetContinuationCount++;
            yield {
              type: 'recovery',
              reason: 'token_budget_continuation',
              attempt: budgetContinuationCount,
            };

            const nudgeMessage: LLMMessage = {
              role: 'user',
              content: '[System: Continue working. You still have budget remaining.]',
            };

            state = {
              ...state,
              messages: [...messages, assistantMessage, nudgeMessage],
              turnCount: turnCount + 1,
              transition: { reason: 'token_budget_continuation' },
            };
            continue;
          }
        }

        // Normal completion
        if (fullText) yield { type: 'text_done', content: fullText };
        yield { type: 'turn_end', iteration: turnCount - 1, hasToolCalls: false };
        return { reason: 'stop', usage };
      }

      // --- Collect remaining tool results (include early results from streaming phase) ---
      const toolResultMessages: LLMMessage[] = [...earlyToolResults];
      let hasToolError = false;
      const touchedFilePaths: string[] = [];

      // Drain remaining progress events
      for (const progress of streamingExecutor.getProgressEvents()) {
        yield {
          type: 'tool_progress',
          toolCallId: progress.toolCallId,
          toolName: progress.toolName,
          data: progress.data,
        };
      }

      for await (const completed of streamingExecutor.getRemainingResults()) {
        yield {
          type: 'tool_call_end',
          toolCallId: completed.id,
          result: completed.result,
          duration: completed.duration,
        };

        if (completed.result.isError && onToolError === 'stop') {
          toolResultMessages.push({
            role: 'tool',
            content: completed.result.content,
            tool_call_id: completed.id,
          });
          yield { type: 'turn_end', iteration: turnCount - 1, hasToolCalls: true };
          return { reason: 'error', usage };
        }

        if (completed.result.isError) hasToolError = true;

        // Pin skill tool results so they survive compaction
        const toolResultMsg: LLMMessage = {
          role: 'tool',
          content: completed.result.content,
          tool_call_id: completed.id,
        };
        if (completed.name === SKILL_TOOL_NAME) {
          (toolResultMsg as unknown as Record<string, unknown>)._pinned = true;
        }
        toolResultMessages.push(toolResultMsg);

        // Extract file paths for conditional skill activation
        if (config.onFilePathsTouched) {
          const toolDef = toolExecutor.listTools().find((t) => t.name === completed.name);
          if (toolDef?.getFilePath) {
            const tc = toolCalls.find((c) => c.id === completed.id);
            if (tc) {
              try {
                const parsed: unknown = JSON.parse(tc.arguments);
                try {
                  const paths = toolDef.getFilePath(parsed);
                  if (paths) {
                    const arr = Array.isArray(paths) ? paths : [paths];
                    touchedFilePaths.push(...arr);
                  }
                } catch {
                  /* getFilePath error — skip */
                }
              } catch {
                /* JSON parse error — skip */
              }
            }
          }
          // Also check metadata.filePaths
          const metaPaths = completed.result.metadata?.filePaths;
          if (Array.isArray(metaPaths)) {
            touchedFilePaths.push(...metaPaths.filter((p): p is string => typeof p === 'string'));
          }
        }
      }

      // --- Conditional skill activation from file operations ---
      if (config.onFilePathsTouched && touchedFilePaths.length > 0) {
        const activated = config.onFilePathsTouched(touchedFilePaths);
        for (const skillName of activated) {
          yield { type: 'skill_activated', skillName };
        }
      }

      // --- onToolError: 'retry' — re-run LLM turn so model can correct its args ---
      if (hasToolError && onToolError === 'retry' && state.toolRetryCount < 1) {
        yield {
          type: 'recovery',
          reason: 'tool_retry' as RecoveryReason,
          attempt: state.toolRetryCount + 1,
        };
        state = {
          ...state,
          messages: [...messages, assistantMessage, ...toolResultMessages],
          turnCount: turnCount + 1,
          consecutiveErrors: 0,
          toolRetryCount: state.toolRetryCount + 1,
          transition: { reason: 'next_turn' },
        };
        continue;
      }

      yield { type: 'turn_end', iteration: turnCount - 1, hasToolCalls: true };

      // --- Continue site: next_turn ---
      state = {
        ...state,
        messages: [...messages, assistantMessage, ...toolResultMessages],
        turnCount: turnCount + 1,
        consecutiveErrors: 0,
        transition: { reason: 'next_turn' },
      };
      continue;
    } catch (error) {
      const classified = classifyAPIError(error);

      // --- PTL Recovery (413) ---
      if (classified instanceof PromptTooLongError && !state.hasAttemptedCompaction) {
        if (maxContextTokens) {
          // Use original messages from state (not compactedMessages which may already be compacted)
          const compactResult = await autocompact([...state.messages], client, {
            maxContextTokens,
            compactionThreshold: 0.1, // Force compaction
            tailProtection: DEFAULT_TAIL_PROTECTION,
          });

          if (compactResult) {
            yield { type: 'recovery', reason: 'reactive_compact_retry', attempt: 1 };
            yield {
              type: 'compaction',
              strategy: 'autocompact',
              tokensFreed: compactResult.tokensFreed,
            };

            state = {
              ...state,
              messages: compactResult.messages,
              hasAttemptedCompaction: true,
              transition: { reason: 'reactive_compact_retry' },
            };
            continue;
          }
        }

        return { reason: 'prompt_too_long', usage };
      }

      if (classified instanceof PromptTooLongError) {
        return { reason: 'prompt_too_long', usage };
      }

      // --- Insufficient Credits (402) — non-recoverable ---
      if (classified instanceof InsufficientCreditsError) {
        yield { type: 'error', error: classified, recoverable: false };
        return { reason: 'error', usage, error: classified };
      }

      // --- Model Fallback (529/503) ---
      if (
        classified instanceof OverloadedError &&
        fallbackModel &&
        currentModel !== fallbackModel
      ) {
        yield { type: 'model_fallback', from: currentModel, to: fallbackModel };
        currentModel = fallbackModel;

        state = {
          ...state,
          transition: { reason: 'model_fallback' },
        };
        continue;
      }

      // --- Generic error recovery ---
      const newConsecutiveErrors = consecutiveErrors + 1;
      const actualError = classified instanceof Error ? classified : new Error(String(classified));
      yield {
        type: 'error',
        error: actualError,
        recoverable: newConsecutiveErrors < maxConsecutiveErrors,
      };

      if (newConsecutiveErrors >= maxConsecutiveErrors) {
        return { reason: 'error', usage, error: actualError };
      }

      state = {
        ...state,
        consecutiveErrors: newConsecutiveErrors,
        transition: undefined,
      };
      continue;
    }
  }
}
