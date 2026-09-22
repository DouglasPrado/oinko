import {
  Agent,
  JevDecider,
  RecordingDecider,
  JsonlSink,
  type Decider,
} from "@gba/ai-harness";
import { config } from "./config.js";
import { createTools } from "./tools.js";

let agent: Agent | null = null;
let decisionSink: JsonlSink | null = null;

/**
 * Monta o decisor com gravacao ligada.
 *
 * Tudo que ele decidir vai para um JSONL — ponto, veredito, confianca e
 * latencia — para depois medir com `pnpm analyze:decisions`. O estado avaliado
 * e gravado como digest: e mensagem de usuario, e log nao e lugar para isso.
 *
 * Sem TYPESAFE_API_KEY devolve undefined, e o agente segue nas heuristicas.
 */
function createDecider(): Decider | undefined {
  if (!config.typesafe.apiKey) {
    console.log("TYPESAFE_API_KEY ausente — rodando sem decisor (heuristicas de sempre)");
    return undefined;
  }

  decisionSink = new JsonlSink(config.typesafe.decisionLog);
  console.log(`Decisor ligado — log em ${config.typesafe.decisionLog}`);

  return new RecordingDecider(
    new JevDecider({ apiKey: config.typesafe.apiKey }),
    (record) => decisionSink?.write(record),
  );
}

/**
 * Creates and configures the shared Agent instance.
 * Uses a singleton — one agent handles all Telegram chats.
 * Each chat is isolated via threadId = chatId.
 */
export async function getAgent(): Promise<Agent> {
  if (agent) return agent;

  const decider = createDecider();

  agent = Agent.create({
    apiKey: config.agent.apiKey,
    baseUrl: config.agent.baseUrl,
    model: config.agent.model,

    embedding: config.embedding.apiKey || config.embedding.baseUrl ? {
      apiKey: config.embedding.apiKey,
      baseUrl: config.embedding.baseUrl,
      model: config.embedding.model,
    } : undefined,

    transcription: config.transcription.apiKey || config.transcription.baseUrl ? {
      apiKey: config.transcription.apiKey,
      baseUrl: config.transcription.baseUrl,
      model: config.transcription.model,
    } : undefined,
    systemPrompt: `You are Albert, a helpful Telegram assistant for managing businesses on the Albert platform.

You have PERSISTENT MEMORY across conversations. You remember facts, preferences, and context from previous messages. Never say you don't have memory or don't remember previous conversations — you do.

CRITICAL RULES FOR TOOL USAGE:
- You HAVE tools available. NEVER say you don't have access to tools or can't query data — you CAN.
- When the user asks for data or actions (listing, creating, updating, searching), ALWAYS use the appropriate tool.
- Do NOT use tools for greetings, thanks, small talk, opinions, or general conversation.
- If the user says "obrigado", "ok", "entendi", just respond naturally WITHOUT calling any tool.
- Think before acting: does this message require data from an external system? If yes, USE your tools. If no, just respond.
- NEVER refuse a data request claiming you can't access the platform — you have full tool access.

Formatting:
- Be concise. Telegram messages should be short and readable.
- Use plain text or minimal Markdown (bold, italic, code blocks).
- Do NOT use headers (#) — Telegram doesn't render them.
- Use emojis to make the conversation more engaging.
- Respond in the same language the user writes in.`,

    memory: {
      enabled: true,
      samplingRate: 0.4,
      extractionInterval: 20,
    },

    knowledge: { enabled: false },

    costPolicy: {
      maxTokensPerExecution: 30_000,
      maxTokensPerSession: 1_000_000,
      onLimitReached: "warn",
    },

    ...(decider !== undefined && { decider }),

    // Roteamento so existe com decisor E com um modelo barato configurado.
    ...(decider !== undefined && config.typesafe.fastModel
      ? { routing: { fastModel: config.typesafe.fastModel, minConfidence: 0.85 } }
      : {}),

    ...(config.telemetry.enabled && {
      telemetry: {
        dbPath: config.telemetry.dbPath,
        retentionDays: config.telemetry.retentionDays,
        capturePayloads: config.telemetry.capturePayloads,
        // Separa este bot dos outros que escrevam no mesmo banco.
        app: "telegram-bot",
      },
    }),

    maxIterations: 20,
    onToolError: "continue",
    logLevel: "debug",
    dbPath: "./data/agent.db",
  });

  if (config.telemetry.enabled) {
    console.log(`Telemetria ligada — banco em ${config.telemetry.dbPath}`);
  }

  // Register tools
  for (const tool of createTools()) {
    agent.addTool(tool);
  }


  return agent;
}

export async function destroyAgent(): Promise<void> {
  if (agent) {
    await agent.destroy();
    agent = null;
  }
  // Escreve o que ficou no buffer antes de sair — senao as ultimas decisoes
  // da sessao se perdem justo na hora de medir.
  if (decisionSink) {
    await decisionSink.close();
    console.log("Log de decisoes:", decisionSink.stats());
    decisionSink = null;
  }
}
