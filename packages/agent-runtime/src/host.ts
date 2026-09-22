import { join } from 'node:path';
import {
  Agent,
  SQLiteDatabase,
  SQLiteConversationStore,
  TelemetryDatabase,
  type AgentConfigInput,
} from '@oinko/core';
import { AgentRuntime } from './index.js';
export interface AgentHostConfig {
  id: string;
  dataDir: string;
  agent: AgentConfigInput;
  telemetryDbPath: string;
  telemetryEnabled: boolean;
  capturePayloads: 'none' | 'hashed' | 'full';
  retentionDays: number;
}
export function createAgentHost(config: AgentHostConfig) {
  const database = new SQLiteDatabase(join(config.dataDir, 'conversations.db'));
  database.initialize();
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
    const agent = Agent.create({
      ...config.agent,
      conversation: { store: new SQLiteConversationStore(database) },
      memory: { enabled: true, memoryDir: join(config.dataDir, 'memory'), ...config.agent.memory },
      knowledge: config.agent.knowledge ?? { enabled: false },
      telemetry: {
        enabled: config.telemetryEnabled,
        dbPath: config.telemetryDbPath,
        app: config.id,
        capturePayloads: config.capturePayloads,
        retentionDays: config.retentionDays,
      },
      costPolicy: {
        maxTokensPerExecution: 30_000,
        maxTokensPerSession: 1_000_000,
        onLimitReached: 'warn',
        ...config.agent.costPolicy,
      },
      logLevel: 'warn',
    });
    // Register shared tools, skills and MCP integrations here, once per agent.
    const runtime = new AgentRuntime(config.id, agent);
    return {
      agent,
      runtime,
      async close() {
        await runtime.drain();
        try {
          await agent.destroy();
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
