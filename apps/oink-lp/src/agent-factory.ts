import { createAgentHost } from '@oinko/agent-runtime';
import {
  createHiggsfieldIntegration,
  HIGGSFIELD_INSTRUCTIONS,
  readCredential,
} from '@oinko/mcp-higgsfield';
import type { AppConfig } from './config.js';

export function createAgent(config: AppConfig) {
  const enabled =
    config.HIGGSFIELD !== 'off' && Boolean(readCredential(config.HIGGSFIELD_CREDENTIAL_PATH));
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
      systemPrompt: config.AGENT_SYSTEM_PROMPT + (enabled ? HIGGSFIELD_INSTRUCTIONS : ''),
      transcription: {
        apiKey: config.TRANSCRIPTION_API_KEY,
        baseUrl: config.TRANSCRIPTION_BASE_URL,
        model: config.TRANSCRIPTION_MODEL,
      },
    },
  });
  const higgsfield = enabled
    ? createHiggsfieldIntegration({
        credentialPath: config.HIGGSFIELD_CREDENTIAL_PATH,
        tools: config.HIGGSFIELD_TOOLS.split(',')
          .map((name) => name.trim())
          .filter(Boolean),
        url: config.HIGGSFIELD_MCP_URL,
      })
    : undefined;
  const ready = higgsfield
    ? higgsfield.connect(host.agent).catch(() => {
        console.error(
          'Higgsfield indisponível. Confira a autorização na dashboard e reinicie o agente.',
        );
      })
    : Promise.resolve();
  return {
    runtime: host.runtime,
    ready,
    async close() {
      await ready;
      try {
        await host.close();
      } finally {
        await higgsfield?.close();
      }
    },
  };
}
