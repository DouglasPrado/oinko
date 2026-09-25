import { z, ZodError } from 'zod';
import type {
  AgentTool,
  ToolProgressCallback,
  ToolExecuteContext,
} from '../contracts/entities/agent-tool.js';
import type { AgentToolResult } from '../contracts/entities/tool-call.js';
import type { ToolDefinition } from '../llm/message-types.js';
import { retry } from '../utils/retry.js';
import { truncateMiddle } from '../utils/truncate.js';
import { classifyToolError } from './error-classifier.js';
import { screenUntrustedContent } from './injection-guard.js';
import type { Decider } from '../contracts/entities/decider.js';
import type { Logger } from '../utils/logger.js';

export interface ToolCallRequest {
  name: string;
  args: unknown;
}

export interface ToolHooks {
  beforeToolCall?: (name: string, args: unknown) => void | Promise<void>;
  afterToolCall?: (name: string, args: unknown, result: AgentToolResult) => void | Promise<void>;
  onToolProgress?: (name: string, toolCallId: string, data: Record<string, unknown>) => void;
}

export interface ExecuteOptions {
  signal?: AbortSignal;
  /** Execucao que motivou a chamada, repassada a tool. */
  traceId?: string;
  toolCallId?: string;
  threadId?: string;
  /** When the current turn began, repassado a tool. */
  turnStartedAt?: number;
  recentMessages?: number;
  onProgress?: ToolProgressCallback;
}

const DEFAULT_MAX_RESULT_CHARS = 10_000;

/**
 * Registers tools, validates args via Zod, converts to JSON Schema,
 * and executes tools with full pipeline:
 *
 *   1. Tool lookup
 *   2. Zod schema validation
 *   3. Semantic validation (tool.validate)
 *   4. Before hook
 *   5. Per-tool timeout wrapping
 *   6. Retry for transient failures
 *   7. Execute with progress callback
 *   8. Result truncation (tool.maxResultChars)
 *   9. Result mapping (tool.mapResult)
 *  10. After hook
 */
/** Hooks plus the optional collaborators the executor can consult. */
export interface ToolExecutorOptions extends ToolHooks {
  /** When set, a failed retryable tool has its error classified before retrying. */
  decider?: Decider;
  logger?: Logger;
  archiveResult?: (name: string, result: AgentToolResult, context: ToolExecuteContext) => void;
}

export class ToolExecutor {
  private readonly tools = new Map<string, AgentTool>();
  private readonly hooks: ToolHooks;
  private readonly decider?: Decider;
  private readonly logger?: Logger;
  private readonly archiveResult?: ToolExecutorOptions['archiveResult'];

  constructor(
    options: ToolExecutorOptions = {},
    private readonly parent?: ToolExecutor,
    /** Names this view neither lists nor runs, wherever they are registered. */
    private readonly hidden: ReadonlySet<string> = new Set(),
  ) {
    this.hooks = options;
    this.decider = options.decider;
    this.logger = options.logger;
    this.archiveResult = options.archiveResult;
  }

  /**
   * An execution-local overlay; newly connected tools remain visible through
   * the parent. `hidden` tools are left out of it: not offered, not run.
   */
  scope(hidden: Iterable<string> = []): ToolExecutor {
    return new ToolExecutor(
      {
        ...this.hooks,
        decider: this.decider,
        logger: this.logger,
        archiveResult: this.archiveResult,
      },
      this,
      new Set([...this.hidden, ...hidden]),
    );
  }

  private getTool(name: string): AgentTool | undefined {
    if (this.hidden.has(name)) return undefined;
    return this.tools.get(name) ?? this.parent?.getTool(name);
  }

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  listTools(): AgentTool[] {
    return [
      ...new Map([
        ...(this.parent?.listTools() ?? []).map((t) => [t.name, t] as const),
        ...this.tools,
      ]).values(),
    ].filter((tool) => !this.hidden.has(tool.name));
  }

  getToolDefinitions(): ToolDefinition[] {
    return this.listTools().map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.parameters, { target: 'draft-7' }),
      },
    }));
  }

  async execute(
    name: string,
    args: unknown,
    signalOrOptions?: AbortSignal | ExecuteOptions,
  ): Promise<AgentToolResult> {
    // Normalize options (backward compatible — accepts bare AbortSignal)
    const opts: ExecuteOptions =
      signalOrOptions instanceof AbortSignal
        ? { signal: signalOrOptions }
        : (signalOrOptions ?? {});

    const tool = this.getTool(name);
    if (!tool) {
      return { content: `Tool "${name}" not found`, isError: true };
    }

    // 1. Zod schema validation
    let validatedArgs: unknown;
    try {
      validatedArgs = tool.parameters.parse(args);
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          content: `Validation error: ${error.issues.map((e) => e.message).join(', ')}`,
          isError: true,
        };
      }
      return { content: `Validation error: ${String(error)}`, isError: true };
    }

    // 2. Semantic validation (tool.validate)
    if (tool.validate) {
      try {
        const validationError = await tool.validate(validatedArgs, {
          threadId: opts.threadId ?? 'default',
          recentMessages: opts.recentMessages ?? 0,
        });
        if (validationError) {
          return { content: `Validation error: ${validationError}`, isError: true };
        }
      } catch (error) {
        return {
          content: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        };
      }
    }

    // 3. Before hook
    if (this.hooks.beforeToolCall) {
      await this.hooks.beforeToolCall(name, validatedArgs);
    }

    // 4. Build execution signal (per-tool timeout + parent signal)
    const execSignal = this.buildSignal(tool, opts.signal);

    // 5. Build progress callback
    const onProgress: ToolProgressCallback | undefined =
      opts.onProgress ??
      (opts.toolCallId && this.hooks.onToolProgress
        ? (data) => this.hooks.onToolProgress!(name, opts.toolCallId!, data)
        : undefined);

    // 6. Execute (with retry if retryable)
    let result: AgentToolResult;
    try {
      result = await this.executeWithRetry(tool, validatedArgs, execSignal, onProgress, {
        ...(opts.traceId !== undefined && { traceId: opts.traceId }),
        ...(opts.threadId !== undefined && { threadId: opts.threadId }),
        ...(opts.toolCallId !== undefined && { toolCallId: opts.toolCallId }),
        ...(opts.turnStartedAt !== undefined && { turnStartedAt: opts.turnStartedAt }),
      });
    } catch (error) {
      result = {
        content: `Tool error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }

    // Save the original output before any prompt truncation. Retrieval itself
    // is not archived again, avoiding recursive copies of the same artifact.
    if (
      this.archiveResult &&
      opts.threadId &&
      opts.toolCallId &&
      name !== 'ToolResult' &&
      name !== 'ToolSearch'
    ) {
      this.archiveResult(name, result, opts);
    }

    // 7. Result truncation
    const maxChars = tool.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
    if (!result.isError && result.content.length > maxChars) {
      result = {
        ...result,
        content:
          truncateMiddle(result.content, maxChars) +
          (this.archiveResult && opts.threadId && opts.toolCallId
            ? `\n[Full output archived. Use ToolResult with reference ${JSON.stringify(opts.toolCallId)} to retrieve missing details.]`
            : ''),
        metadata: { ...result.metadata, truncated: true, originalLength: result.content.length },
      };
    }

    // 8. Result mapping
    if (tool.mapResult) {
      result = tool.mapResult(result);
    }

    // Content from outside the conversation is screened before the model sees
    // it: an instruction hidden in a web page would otherwise carry the same
    // weight as the operator's own prompt.
    if (this.decider && tool.untrustedOutput === true && !result.isError) {
      const screened = await screenUntrustedContent(result.content, tool.name, this.decider, {
        ...(this.logger !== undefined && { logger: this.logger }),
      });
      if (screened.suspected) {
        result = {
          ...result,
          content: screened.content,
          metadata: { ...result.metadata, suspectedInjection: true },
        };
      }
    }

    // 9. After hook
    if (this.hooks.afterToolCall) {
      await this.hooks.afterToolCall(name, validatedArgs, result);
    }

    return result;
  }

  async executeParallel(
    calls: ToolCallRequest[],
    signal?: AbortSignal,
  ): Promise<AgentToolResult[]> {
    const callsWithId = calls.map((c, i) => ({ id: String(i), name: c.name, args: c.args }));
    const results = await this.executePartitioned(callsWithId, signal);
    results.sort((a, b) => Number(a.id) - Number(b.id));
    return results.map((r) => r.result);
  }

  /**
   * Executes tool calls respecting concurrency safety:
   * - Consecutive concurrency-safe tools run in parallel
   * - Non-safe tools run serially (one at a time)
   * - Results are returned in the original call order
   */
  async executePartitioned(
    calls: { id: string; name: string; args: unknown }[],
    signal?: AbortSignal,
  ): Promise<{ id: string; result: AgentToolResult }[]> {
    const results: { id: string; result: AgentToolResult }[] = [];

    // Partition into batches of consecutive safe/unsafe tools
    const batches: { calls: typeof calls; concurrent: boolean }[] = [];
    let currentBatch: typeof calls = [];
    let currentConcurrent = false;

    for (const call of calls) {
      const tool = this.getTool(call.name);
      const isSafe = tool
        ? typeof tool.isConcurrencySafe === 'function'
          ? tool.isConcurrencySafe(call.args)
          : tool.isConcurrencySafe === true
        : false;

      if (currentBatch.length === 0) {
        currentConcurrent = isSafe;
        currentBatch.push(call);
      } else if (isSafe === currentConcurrent && isSafe) {
        currentBatch.push(call);
      } else {
        batches.push({ calls: currentBatch, concurrent: currentConcurrent });
        currentBatch = [call];
        currentConcurrent = isSafe;
      }
    }
    if (currentBatch.length > 0) {
      batches.push({ calls: currentBatch, concurrent: currentConcurrent });
    }

    for (const batch of batches) {
      if (batch.concurrent) {
        const batchResults = await Promise.all(
          batch.calls.map(async (call) => ({
            id: call.id,
            result: await this.execute(call.name, call.args, signal),
          })),
        );
        results.push(...batchResults);
      } else {
        for (const call of batch.calls) {
          const result = await this.execute(call.name, call.args, signal);
          results.push({ id: call.id, result });
        }
      }
    }

    return results;
  }

  // --- Private helpers ---

  /**
   * Build an AbortSignal combining parent signal + per-tool timeout.
   */
  private buildSignal(tool: AgentTool, parentSignal?: AbortSignal): AbortSignal {
    if (!tool.timeoutMs && !parentSignal) {
      return new AbortController().signal;
    }

    if (!tool.timeoutMs) return parentSignal!;

    const timeoutSignal = AbortSignal.timeout(tool.timeoutMs);
    if (!parentSignal) return timeoutSignal;

    // Combine both signals
    return AbortSignal.any([parentSignal, timeoutSignal]);
  }

  /**
   * Execute with retry support using the existing retry utility.
   */
  private async executeWithRetry(
    tool: AgentTool,
    args: unknown,
    signal: AbortSignal,
    onProgress?: ToolProgressCallback,
    context?: ToolExecuteContext,
  ): Promise<AgentToolResult> {
    const execFn = async () => {
      const raw = await tool.execute(args, signal, onProgress, context);
      return typeof raw === 'string' ? { content: raw } : raw;
    };

    if (!tool.retryable) {
      return execFn();
    }

    const isRetryable =
      typeof tool.retryable === 'function'
        ? tool.retryable
        : async (error: unknown) => {
            // Don't retry abort errors — exact and free, no decision needed.
            if (error instanceof DOMException && error.name === 'AbortError') return false;
            if (!this.decider) return true;

            try {
              const kind = await classifyToolError(error, tool.name, this.decider, {
                ...(this.logger !== undefined && { logger: this.logger }),
              });
              return kind === 'transient';
            } catch {
              // Classifier unreachable — retry blindly, as before.
              return true;
            }
          };

    return retry(execFn, {
      maxRetries: tool.maxRetries ?? 2,
      initialDelay: 500,
      backoffMultiplier: 2,
      maxDelay: 5_000,
      signal,
      isRetryable,
    });
  }
}
