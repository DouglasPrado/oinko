// Agent (main entry point)
export { Agent } from './agent.js';
export type { ChatOptions } from './agent.js';

// Contracts (types and enums)
export * from './contracts/index.js';

// Config
export { AgentConfigSchema } from './config/config.js';
export { ContextPolicySchema } from './config/context-policy.js';
export type { ContextPolicy } from './config/context-policy.js';
export type {
  ConversationCheckpoint,
  ArchivedToolResult,
  ContextLifecycleEvent,
} from './contracts/entities/working-context.js';
export type {
  AgentConfig,
  AgentConfigInput,
  MCPConnectionConfig,
  MCPConnectionConfigInput,
  CostPolicy,
} from './config/config.js';

// File-based memory system
export { FileMemorySystem } from './memory/file-memory-system.js';
export type { FileMemoryConfig } from './memory/file-memory-system.js';
export type {
  MemoryType,
  MemoryHeader,
  MemoryFile,
  SaveMemoryInput,
} from './memory/memory-types.js';

// Model knowledge (capabilities by family, endpoint naming)
export { findModelFamily, checkModelSuitsEndpoint } from './llm/model-registry.js';
export type { ModelFamily } from './llm/model-registry.js';

// Pluggable stores (for custom implementations)
export { SQLiteVectorStore } from './knowledge/sqlite-vector-store.js';
export { SQLiteConversationStore } from './storage/sqlite-conversation-store.js';
export { SQLiteDatabase } from './storage/sqlite-database.js';

// Decision engine (System One decider)
export { JevDecider, JevError } from './decision/jev-decider.js';
export { RecordingDecider, inferDecisionPoint } from './decision/recording-decider.js';
export type { DecisionRecord, DecisionPoint, StateMode } from './decision/recording-decider.js';
export { ShadowDecider } from './decision/shadow-decider.js';
export type { ShadowRecord } from './decision/shadow-decider.js';
export { JsonlSink } from './decision/jsonl-sink.js';
export type { JsonlSinkOptions, JsonlSinkStats } from './decision/jsonl-sink.js';
export type { JevDeciderOptions } from './decision/jev-decider.js';
export { shouldExtractWithDecider, DURABLE_FACT_QUESTIONS } from './memory/extraction-gate.js';
export { findDuplicateMemory, NO_DUPLICATE } from './memory/dedup.js';
export { shouldRetrieveKnowledge, KNOWLEDGE_NEEDED_QUESTION } from './knowledge/retrieval-gate.js';
export { rerankChunks, RELEVANCE_LEVELS } from './knowledge/rerank.js';
export { decideSkill, NO_SKILL } from './skills/skill-decider.js';
export { classifyToolError, TOOL_ERROR_KINDS } from './tools/error-classifier.js';
export {
  screenUntrustedContent,
  UNTRUSTED_WRAPPER,
  INSTRUCTS_AGENT_QUESTION,
} from './tools/injection-guard.js';
export type { ScreenResult } from './tools/injection-guard.js';
export { routeModel, ROUTE_TIERS } from './llm/model-router.js';
export { isLoopProductive, PROGRESS_QUESTION } from './core/progress-gate.js';
export { screenTurn, JAILBREAK_QUESTION } from './core/turn-screening.js';
export type { JailbreakConfig, TurnScreeningResult } from './core/turn-screening.js';
export type { ModelRouteOptions } from './llm/model-router.js';
export type { ToolErrorKind } from './tools/error-classifier.js';
export type { ExtractionGateConfig } from './memory/extraction-gate.js';
export type { RetrievalGateConfig } from './knowledge/retrieval-gate.js';
export type { RerankOptions } from './knowledge/rerank.js';

// Builtin tools
export { builtinTools } from './tools/builtin/index.js';
export {
  createGlobTool,
  createGrepTool,
  createFileReadTool,
  createFileWriteTool,
  createFileEditTool,
  createBashTool,
  createWebFetchTool,
  createAskUserTool,
  createConversationSearchTool,
  CONVERSATION_SEARCH_TOOL_NAME,
  CONVERSATION_SEARCH_GUIDANCE,
} from './tools/builtin/index.js';
export type { AskUserOptions, ConversationSearchToolOptions } from './tools/builtin/index.js';

// SQL query tools
export { createSqlTools } from './tools/sql/index.js';
export type { SqlToolFactoryOptions, SqlQueryRunner, SqlQueryDef } from './tools/sql/index.js';

// JSON Schema → Zod
export { jsonSchemaToZod } from './tools/json-schema-to-zod.js';

// MCP
export { MCPAdapter } from './tools/mcp-adapter.js';
export type {
  MCPHealthStatus,
  MCPResource,
  MCPPromptInfo,
  MCPConnectionInfo,
} from './tools/mcp-adapter.js';

// Skills
export { SkillManager } from './skills/skill-manager.js';
export { createSkillTool, SKILL_TOOL_NAME } from './tools/skill-tool.js';
export { scanSkillFiles, loadSkillFile, parseSkillFrontmatter } from './skills/skill-loader.js';
export { substituteArgs } from './skills/skill-args.js';
export { matchGlob, matchAnyGlob } from './skills/skill-glob.js';

// Turn-end hooks
export { runTurnEndHooks } from './core/turn-end-hooks.js';
export type { TurnEndHook, TurnEndHookContext, TurnEndHookResult } from './core/turn-end-hooks.js';

// Prompt builders
export { buildToolUsagePrompt, buildEnvironmentPrompt } from './core/prompt-builders.js';
export type { EnvironmentInfo } from './core/prompt-builders.js';

// Message normalization
export { normalizeMessagesForAPI } from './core/message-normalize.js';

// Prompt cache
export { PromptSectionCache } from './core/prompt-cache.js';

// Context analysis
export { analyzeContext } from './core/context-analysis.js';
export type { ContextAnalysis } from './core/context-analysis.js';

// Model utilities
export { getModelContextWindow } from './utils/model-context.js';

// LLM Client
export { LLMClient } from './llm/llm-client.js';
export type { LLMClientConfig, TranscribeParams, TranscribeResult } from './llm/llm-client.js';

// LLM Message Types
export type {
  LLMMessage,
  LLMToolCall,
  LLMContentPart,
  StreamChunk,
  ChatResponse,
  StreamChatParams,
  ChatParams,
  ToolDefinition,
  ResponseFormat,
  ReasoningEffort,
} from './llm/message-types.js';

// Utils
export { createLogger } from './utils/logger.js';
export type { Logger, LoggerOptions } from './utils/logger.js';
export { LRUCache } from './utils/cache.js';
export type { CacheOptions } from './utils/cache.js';
export { retry } from './utils/retry.js';
export type { RetryOptions } from './utils/retry.js';
export { estimateTokens } from './utils/token-counter.js';

// Tool extension types — consumers implementing custom tools/hooks
export type { ToolCallRequest, ToolHooks, ExecuteOptions } from './tools/tool-executor.js';
export type { SkillToolContext } from './tools/skill-tool.js';
export type { BashToolOptions } from './tools/builtin/bash.js';

// Knowledge extension types
export type { ChunkingOptions } from './knowledge/chunking.js';
export type { KnowledgeManagerConfig } from './knowledge/knowledge-manager.js';

// Skill extension types
export type { SkillFrontmatter } from './skills/skill-loader.js';
export type { SkillMatchResult } from './skills/skill-manager.js';

// Core/loop types — for hooks, observability, and custom loop config
export type { ReactLoopConfig, TokenBudgetConfig } from './core/react-loop.js';
export type { StopHookContext, StopHookResult } from './core/stop-hooks.js';
export type { TurnEndHooksResult } from './core/turn-end-hooks.js';
export type { ToolExecutionResult, ToolProgressInfo } from './core/streaming-tool-executor.js';
export type {
  TerminalReason,
  ContinueReason,
  Continue,
  AutoCompactTracking,
} from './core/loop-types.js';
export type { ContextBuildResult } from './core/context-builder.js';

// Memory util
export { getDefaultMemoryDir } from './memory/memory-paths.js';

// Loop dependency injection (consumers extending or testing the loop)
export { createProductionDeps } from './core/loop-deps.js';
export type { LoopDeps } from './core/loop-deps.js';

// Telemetry
export { TelemetryDatabase } from './telemetry/telemetry-database.js';
export { SqliteTelemetrySink } from './telemetry/sqlite-telemetry-sink.js';
export { PayloadStore } from './telemetry/payload-store.js';
export { guardSink } from './telemetry/safe-sink.js';
export { redactSecrets } from './telemetry/redact.js';
export { purgeTelemetry } from './telemetry/purge.js';
export { traceDecisions } from './telemetry/decision-bridge.js';
export { CostEnricher } from './telemetry/cost-enricher.js';
export type { CostEnricherOptions } from './telemetry/cost-enricher.js';
export type { GenerationStats } from './llm/llm-client.js';
export { GenerationNotReadyError } from './llm/errors.js';
export { SensitiveDataError } from './memory/errors.js';
export { DEFAULT_BEHAVIOR_PROMPT } from './core/behavior-prompt.js';
export { findNeverStore, maskPersonalIdentifiers } from './utils/sensitive-data.js';
export type { SensitiveKind, SensitiveFinding } from './utils/sensitive-data.js';
export type { DecisionTraceContext } from './telemetry/decision-bridge.js';
export type { PurgeOptions, PurgeResult } from './telemetry/purge.js';
export type {
  SqliteTelemetrySinkOptions,
  CapturePayloads,
} from './telemetry/sqlite-telemetry-sink.js';
export type { TelemetryMigration } from './telemetry/migrations.js';
export type { TelemetryConfig } from './config/config.js';
export type { LLMCallTelemetry } from './core/react-loop.js';
