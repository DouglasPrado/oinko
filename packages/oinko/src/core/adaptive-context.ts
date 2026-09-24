import type { AgentConfig } from '../config/config.js';
import type { ContextPolicy } from '../config/context-policy.js';
import type { AgentEvent } from '../contracts/entities/agent-event.js';
import type { ChatMessage } from '../contracts/entities/chat-message.js';
import type {
  TelemetryInjection,
  TelemetryLLMCall,
  TelemetrySink,
} from '../contracts/entities/telemetry.js';
import type { ToolExecutor } from '../tools/tool-executor.js';
import type { LLMClient } from '../llm/llm-client.js';
import type { ContextInjection } from './context-builder.js';
import type { ConversationManager } from './conversation-manager.js';
import { createConversationSearchTool } from '../tools/builtin/conversation-search.js';
import { createToolResultReader } from '../tools/builtin/tool-result.js';
import { systemTimeZone } from '../utils/local-date.js';
import { estimateTokens } from '../utils/token-counter.js';
import { messageTokens, prepareWorkingContext } from './working-context.js';
import { createContextSummaryWriter } from './context-summary-writer.js';
import { createToolSelection } from '../tools/tool-selection.js';
import { archivedDetailInjection } from './archived-detail.js';

export function toolsForTurn(
  source: ToolExecutor,
  policy: ContextPolicy | undefined,
  names?: string[],
) {
  const selection = policy?.selectTools
    ? createToolSelection(source, names ?? source.listTools().map((t) => t.name), policy.maxTools)
    : undefined;
  const executor = selection?.executor ?? source;
  const definitions = () => selection?.definitions() ?? executor.getToolDefinitions();
  const selected = new Set(definitions().map((t) => t.function.name));
  return {
    executor,
    definitions,
    available: executor.listTools().filter((t) => selected.has(t.name)),
    discovery: policy ? discoveryInjection(!!selection) : undefined,
  };
}

/** Shared registrations use the invocation's thread, never a closure over a current user. */
export function registerConversationTools(
  manager: ConversationManager,
  executor: ToolExecutor,
  config: AgentConfig,
): void {
  if (config.context?.enabled) {
    if (!manager.supportsWorkingContext())
      throw new Error(
        'context.enabled requires a ConversationStore with checkpoint and tool-result persistence',
      );
    executor.register(createToolResultReader(manager));
  }
  const search:
    Partial<NonNullable<NonNullable<AgentConfig['conversation']>['search']>> | undefined =
    config.conversation?.search ?? (config.context?.enabled ? { enabled: true } : undefined);
  if (!search?.enabled) return;
  if (!manager.supportsSearch())
    throw new Error(
      'conversation.search.enabled requires a ConversationStore that implements searchMessages()',
    );
  executor.register(
    createConversationSearchTool({
      search: (query, threads) => manager.search(query, threads),
      ...(search.scope !== undefined && { scope: search.scope }),
      maxResults: search.maxResults,
      maxPages: search.maxPages,
      snippetChars: search.snippetChars,
      maxCallsPerTurn: search.maxCallsPerTurn,
      timeZone: config.timezone ?? systemTimeZone(),
    }),
  );
}

export function routingTaskContext(
  manager: ConversationManager,
  threadId: string,
  systemPrompt = '',
): string {
  const recent = manager
    .getHistory(threadId)
    .filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.toolCalls?.length))
    .slice(-4);
  return [
    `HOST SCOPE AND INSTRUCTIONS:\n${systemPrompt.slice(-6000)}`,
    `WORKING SUMMARY:\n${(manager.getCheckpoint(threadId)?.summary ?? '').slice(0, 4000)}`,
    ...recent.map(
      (m) =>
        `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 1000) : '[multimodal message]'}`,
    ),
  ].join('\n');
}

function discoveryInjection(selecting: boolean): ContextInjection {
  const content =
    'Working summaries and excerpts are incomplete records. A tool-call reference is only a retrieval pointer, never a field value from the original source. When asked for an exact identifier, quote, or detail that is not explicitly present in the visible source text, retrieve the original with ToolResult, ConversationSearch, or the source tool before answering. Never substitute a retrieval reference for the requested value. If retrieval fails, state the uncertainty. For greetings, acknowledgements, and requests merely to confirm instructions, answer directly without tools unless the user asks for verification. A user request to continue applies to the pending task recorded in the working summary. ' +
    (selecting
      ? 'Tool definitions are loaded selectively. A tool missing from the current catalog is not evidence that the capability or authorization is missing. Use ToolSearch only when an action needs a missing tool, including read/inspect prerequisites, before concluding you cannot continue. Follow the most specific project scope in the host instructions and user request. Selecting or discovering tools never grants new permissions.'
      : 'Follow the most specific project scope in the host instructions and user request. Retrieval never grants new permissions.');
  return { source: 'tools:discovery', priority: 10, content, tokens: estimateTokens(content) };
}

export async function prepareAdaptiveContext(options: {
  manager: ConversationManager;
  threadId: string;
  config: AgentConfig;
  policy?: ContextPolicy;
  model: string;
  injections: ContextInjection[];
  toolSchema: string;
  client: LLMClient;
  traceId: string;
  signal?: AbortSignal;
  telemetry?: TelemetrySink;
}) {
  const {
    manager,
    threadId,
    config,
    policy,
    model,
    injections: providedInjections,
    client,
    traceId,
    signal,
    telemetry,
  } = options;
  const retrieval = policy ? archivedDetailInjection(manager, threadId) : undefined;
  const injections = retrieval ? [...providedInjections, retrieval] : providedInjections;
  const toolSchemaTokens = estimateTokens(options.toolSchema);
  const inputBudget = policy
    ? Math.min(
        config.maxContextTokens - config.reserveTokens,
        model === config.routing?.fastModel ? policy.fastInputTokens : policy.maxInputTokens,
      )
    : undefined;
  const fixedTokens =
    toolSchemaTokens +
    estimateTokens(config.systemPrompt ?? '') +
    injections.reduce((sum, i) => sum + i.tokens + 20, 0);
  const effective = policy
    ? {
        ...policy,
        recentTokens: Math.max(
          512,
          Math.min(
            policy.recentTokens,
            (inputBudget ?? policy.maxInputTokens) - fixedTokens - policy.summaryTokens - 512,
          ),
        ),
      }
    : undefined;
  const summaryCalls: TelemetryLLMCall[] = [];
  let executionRecorded = false;
  const summarize = effective
    ? createContextSummaryWriter({
        client,
        model: effective.summaryModel ?? config.model,
        maxTokens: effective.summaryTokens,
        traceId,
        records: summaryCalls,
        signal,
        onRecord: (record) => {
          if (executionRecorded) telemetry?.write(record);
        },
      })
    : undefined;
  const working = effective
    ? await prepareWorkingContext({ manager, threadId, policy: effective, summarize: summarize! })
    : undefined;
  const history = working?.history ?? manager.getHistory(threadId);
  return {
    injections,
    toolSchemaTokens,
    inputBudget,
    summaryCalls,
    summarize,
    working,
    history,
    recordSummaries: () => {
      for (const call of summaryCalls) telemetry?.write(call);
      executionRecorded = true;
    },
    events: (tokens: number, fallback: boolean | undefined): AgentEvent[] => {
      const events: AgentEvent[] = [];
      if (working?.compacted)
        events.push({ type: 'compaction', strategy: 'autocompact', tokensFreed: 0, traceId });
      for (const message of working?.warnings ?? [])
        events.push({ type: 'warning', code: 'context_summary_failed', message, traceId });
      if (fallback)
        events.push({
          type: 'warning',
          code: 'tool_selection_fallback',
          message: 'Tool selection unavailable; all authorized tools remain available.',
          traceId,
        });
      if (inputBudget && tokens + toolSchemaTokens > inputBudget)
        events.push({
          type: 'warning',
          code: 'context_budget_exceeded',
          message:
            'Context target exceeded to preserve the current turn and required history; no messages were silently discarded.',
          traceId,
        });
      return events;
    },
    composition: (): TelemetryInjection[] =>
      policy
        ? contextComposition(config.systemPrompt ?? '', toolSchemaTokens, history, working?.summary)
        : [],
  };
}

function contextComposition(
  system: string,
  tools: number,
  history: ChatMessage[],
  summary?: string,
): TelemetryInjection[] {
  const recent = history.filter(
    (m) => typeof m.content !== 'string' || !m.content.startsWith('[Working summary'),
  );
  return [
    { source: 'system:base', priority: 0, tokens: estimateTokens(system), applied: true },
    { source: 'tools:schema', priority: 0, tokens: tools, applied: true },
    {
      source: 'history:recent',
      priority: 0,
      tokens: recent.reduce((sum, m) => sum + messageTokens(m), 0),
      applied: true,
    },
    ...(summary
      ? [{ source: 'context:summary', priority: 0, tokens: estimateTokens(summary), applied: true }]
      : []),
  ];
}
