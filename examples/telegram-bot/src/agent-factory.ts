import {
  Agent,
  JevDecider,
  RecordingDecider,
  JsonlSink,
  type Decider,
} from "@gba/ai-harness";
import { config } from "./config.js";
import { createTools } from "./tools.js";
import { CREDENTIAL_PATH, higgsfieldHeaders, readCredential } from "./higgsfield-auth.js";

/**
 * Regras de geracao, so quando o Higgsfield esta ligado.
 *
 * Cada linha aqui veio de um turno que deu errado: o modelo inventou ids como
 * `higgsfield_preset` e `GPT Image 2`, ficou repetindo `job_status` de 26 em 26
 * segundos, e desistiu de usar a foto recebida porque procurou a ferramenta de
 * upload em vez da que o bot oferece.
 */
const GERACAO_PROMPT = config.higgsfield.enabled
  ? `

Imagem e video (Higgsfield):
- o id do modelo sai de models_explore; nunca invente um nem reaproveite de
  memoria — um id errado gasta uma chamada para dar erro
- para usar a foto que a pessoa mandou como referencia, chame
  preparar_imagem_enviada e passe o media_id em medias
- depois de submeter, espere com jobs_wait; job_status em laco so queima
  contexto
- mande o link do resultado cru na resposta, sem markdown de imagem: quem
  monta o envio da foto e o bot`
  : '';

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
        /**
     * O prompt cobre so o que o SDK nao injeta.
     *
     * As regras de uso de ferramenta ja chegam por `buildToolUsagePrompt`, e a
     * declaracao de memoria persistente vem do sistema de memoria — juntas, mais
     * de seiscentos tokens por turno. Repeti-las aqui gastava contexto duas
     * vezes e, pior, deixava duas versoes da mesma regra para o modelo conciliar.
     *
     * Emoji tambem saiu: quem decide isso e a memoria da conversa, e mandar usar
     * aqui contradizia diretamente a preferencia registrada de quem usa o bot.
     */
    systemPrompt: `Voce e o Oinko, um assistente pessoal.

Responda o que foi perguntado, sem preambulo e sem repetir a pergunta de volta.
Quando faltar informacao para agir, pergunte uma coisa so — a que destrava o
proximo passo.

Prefira o que e verdade ao que soa bem: se nao sabe, diga que nao sabe; se a
ferramenta falhou, diga o que falhou.

O canal e o Telegram:
- mensagens curtas, que caibam na tela de um celular
- texto simples ou markdown minimo: negrito, italico, bloco de codigo
- nada de titulo com #, que o Telegram nao renderiza
- responda no idioma em que a pessoa escreveu${GERACAO_PROMPT}`,

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

  await connectHiggsfield(agent);


  return agent;
}

/**
 * Liga o MCP do Higgsfield, se houver credencial.
 *
 * Falhar aqui nao impede o bot de funcionar: sem as ferramentas de geracao ele
 * continua conversando, e a mensagem diz o que fazer para ligar.
 */
async function connectHiggsfield(agent: Agent): Promise<void> {
  if (!config.higgsfield.enabled) return;

  if (!readCredential(CREDENTIAL_PATH)) {
    console.log(
      "Higgsfield sem credencial — abra a dashboard e autorize para ligar a geracao de imagem e video",
    );
    return;
  }

  try {
    await agent.connectMCP({
      name: "higgsfield",
      transport: "http",
      url: config.higgsfield.url,
      // Resolvido a cada requisicao: o token dura 24 horas.
      getHeaders: () => higgsfieldHeaders(),
      tools: config.higgsfield.tools,
      timeout: config.higgsfield.timeoutMs,
    });
    console.log(`Higgsfield ligado — ${config.higgsfield.tools.length} ferramentas`);
  } catch (error) {
    console.error(
      "Higgsfield nao conectou:",
      error instanceof Error ? error.message : String(error),
    );
  }
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
