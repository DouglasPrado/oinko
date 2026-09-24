import { join } from 'node:path';
import {
  Agent,
  SQLiteDatabase,
  SQLiteConversationStore,
  TelemetryDatabase,
  type AgentConfigInput,
  type AgentTool,
} from '@oinko/core';
import { AgentRuntime, type RuntimeCommands } from './index.js';
import type { NotificationRegistry } from './connections.js';
export interface AgentHostConfig {
  id: string;
  dataDir: string;
  agent: AgentConfigInput;
  telemetryDbPath: string;
  telemetryEnabled: boolean;
  capturePayloads: 'none' | 'hashed' | 'full';
  retentionDays: number;
  tools?: AgentTool[];
  /**
   * Lets the agent search this conversation's earlier messages. Scope is the
   * turn's own thread: same person, same bot, same channel — nothing wider,
   * since nothing here proves two channels belong to the same person.
   */
  conversationSearch?: boolean;
  /** Slash commands answered outside the LLM queue (programming run control). */
  commands?: RuntimeCommands;
  /**
   * A second agent that executes durable programming runs with its own tools
   * and instructions, on the same stores. Chat turns never wait for it.
   */
  programming?: {
    tools: AgentTool[];
    systemPrompt: string;
    /** Per-agent settings (model, routing) that differ from the chat agent. */
    overrides?: Partial<AgentConfigInput>;
  };
  /** Where channels register senders for asynchronous progress messages. */
  notifications?: NotificationRegistry;
}
export function createAgentHost(config: AgentHostConfig) {
  const database = new SQLiteDatabase(join(config.dataDir, 'conversations.db'));
  database.initialize();
  const agents: Agent[] = [];
  try {
    // The dashboard can open an empty database before the first real turn.
    // Schema ownership stays with the SDK rather than the read-only dashboard.
    if (config.telemetryEnabled) {
      const telemetry = new TelemetryDatabase(config.telemetryDbPath);
      try {
        telemetry.initialize();
      } finally {
        telemetry.close();
      }
    }
    const telemetry = {
      enabled: config.telemetryEnabled,
      dbPath: config.telemetryDbPath,
      app: config.id,
      capturePayloads: config.capturePayloads,
      retentionDays: config.retentionDays,
    };
    const agent = Agent.create({
      ...config.agent,
      conversation: {
        store: new SQLiteConversationStore(database),
        ...(config.conversationSearch && { search: { enabled: true } }),
      },
      memory: { enabled: true, memoryDir: join(config.dataDir, 'memory'), ...config.agent.memory },
      knowledge: config.agent.knowledge ?? { enabled: false },
      telemetry,
      costPolicy: {
        maxTokensPerExecution: 30_000,
        maxTokensPerSession: 1_000_000,
        onLimitReached: 'warn',
        ...config.agent.costPolicy,
      },
      logLevel: 'warn',
    });
    agents.push(agent);
    for (const tool of config.tools ?? []) agent.addTool(tool);
    let programmingAgent: Agent | undefined;
    if (config.programming) {
      programmingAgent = Agent.create({
        ...config.agent,
        ...config.programming.overrides,
        systemPrompt: config.programming.systemPrompt,
        conversation: { store: new SQLiteConversationStore(database) },
        // Run threads are work logs, not facts about a person.
        memory: { enabled: false },
        knowledge: { enabled: false },
        telemetry,
        // No financial ceiling: usage is measured and shown, never a stop condition.
        costPolicy: { onLimitReached: 'warn' },
        logLevel: 'warn',
      });
      agents.push(programmingAgent);
      for (const tool of config.programming.tools) programmingAgent.addTool(tool);
    }
    const runtime = new AgentRuntime(config.id, agent, config.commands);
    return {
      agent,
      programmingAgent,
      runtime,
      notifications: config.notifications,
      async close() {
        await runtime.drain();
        try {
          for (const item of agents) await item.destroy();
        } finally {
          database.close();
        }
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
