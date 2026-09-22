import { createAgentHost } from '@oinko/agent-runtime';
import { HIGGSFIELD_INSTRUCTIONS } from '@oinko/mcp-higgsfield';
import type { AppConfig } from './config.js';

export function createAgent(config: AppConfig) {
  const host = createAgentHost({
    id: config.AGENT_ID,
    dataDir: config.dataDir,
    telemetryDbPath: config.telemetryDbPath,
    telemetryEnabled: config.TELEMETRY !== 'off',
    capturePayloads: config.TELEMETRY_CAPTURE,
    retentionDays: config.TELEMETRY_RETENTION_DAYS,
    agent: {
      apiKey: config.LLM_API_KEY,
      baseUrl: config.LLM_BASE_URL,
      model: config.AGENT_MODEL,
      systemPrompt: config.AGENT_SYSTEM_PROMPT + HIGGSFIELD_INSTRUCTIONS,
      transcription: {
        apiKey: config.TRANSCRIPTION_API_KEY,
        baseUrl: config.TRANSCRIPTION_BASE_URL,
        model: config.TRANSCRIPTION_MODEL,
      },
    },
  });
  return host;
}
