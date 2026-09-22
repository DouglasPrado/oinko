import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, JevDecider, RecordingDecider, type DecisionRecord } from '../../src/index.js';
import type { AgentConfigInput } from '../../src/config/config.js';

/** Credenciais vindas do ambiente — sem elas a suite se pula inteira. */
const LLM_KEY = process.env.LLM_API_KEY;
const JEV_KEY = process.env.TYPESAFE_API_KEY;
const MODEL = process.env.AGENT_MODEL ?? 'gpt-5.5';
const BASE_URL = process.env.LLM_BASE_URL;

/**
 * O default do SDK e `openai/text-embedding-3-small`, a grafia do OpenRouter.
 * Contra a API da OpenAI o nome correto e sem prefixo — o mesmo cuidado que
 * vale para o modelo de chat.
 */
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ??
  (BASE_URL?.includes('api.openai.com') ? 'text-embedding-3-small' : undefined);

export const hasLLM = Boolean(LLM_KEY);
export const hasJev = Boolean(JEV_KEY);

/** Tudo que um caso de uso precisa, com limpeza no fim. */
export interface LiveAgent {
  agent: Agent;
  /** Decisoes tomadas nesta execucao, para afirmar sobre o caminho e nao so o resultado. */
  decisions: DecisionRecord[];
  memoryDir: string;
  dispose: () => Promise<void>;
}

export function createLiveAgent(
  overrides: Partial<AgentConfigInput> = {},
  options: { withDecider?: boolean } = {},
): LiveAgent {
  const root = mkdtempSync(join(tmpdir(), 'live-'));
  const memoryDir = join(root, 'memory') + '/';
  const decisions: DecisionRecord[] = [];

  const decider =
    options.withDecider !== false && JEV_KEY
      ? new RecordingDecider(new JevDecider({ apiKey: JEV_KEY }), (r) => decisions.push(r))
      : undefined;

  const agent = Agent.create({
    apiKey: LLM_KEY!,
    ...(BASE_URL !== undefined && { baseUrl: BASE_URL }),
    model: MODEL,
    knowledge: { enabled: false },
    dbPath: join(root, 'agent.db'),
    logLevel: 'silent',
    ...(EMBEDDING_MODEL !== undefined && { embeddingModel: EMBEDDING_MODEL }),
    ...(decider !== undefined && { decider }),
    ...overrides,
    // Depois do spread e mesclado, nao substituido: um override de `memory`
    // trocaria o objeto inteiro e levaria junto o memoryDir temporario — a
    // memoria iria para o diretorio padrao do processo, e o teste olharia uma
    // pasta que ninguem escreveu.
    memory: { enabled: true, ...overrides.memory, memoryDir },
  });

  return {
    agent,
    decisions,
    memoryDir,
    dispose: async () => {
      await agent.destroy();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Espera a extracao de memoria, que roda em background apos o turno. */
export async function settle(ms = 15_000): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Os pontos de decisao acionados, para afirmar que o caminho certo rodou. */
export function pointsOf(decisions: DecisionRecord[]): string[] {
  return [...new Set(decisions.map((d) => d.point))].sort();
}

/**
 * Normaliza a resposta antes de procurar um numero.
 *
 * O modelo escolhe o formato: "1847", "1.847", "1,847". Afirmar sobre a forma
 * exata transforma uma funcionalidade que funciona em teste vermelho
 * intermitente — o que importa e que o dado da tool chegou na resposta.
 */
export function digitsOf(text: string): string {
  return text.replace(/[.,\s]/g, '');
}

/**
 * Espera a extracao de memoria terminar, checando o disco.
 *
 * A extracao roda em background e o tempo dela varia com o modelo — um de
 * raciocinio leva bem mais que um de chat. Dormir um tempo fixo ou deixa o
 * teste lento a toa, ou o reprova por impaciencia quando a funcionalidade
 * esta correta. Esta versao devolve assim que o arquivo aparece.
 */
export async function waitForMemory(
  memoryDir: string,
  threadId: string,
  timeoutMs = 40_000,
): Promise<string[]> {
  const { readdirSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(memoryDir, 'threads', threadId);
  const limite = Date.now() + timeoutMs;

  while (Date.now() < limite) {
    if (existsSync(dir)) {
      const arquivos = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
      if (arquivos.length > 0) return arquivos;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return [];
}

/**
 * Minuscula e sem acento.
 *
 * O modelo escreve "Tóquio"; afirmar sobre "toquio" reprovaria uma resposta
 * correta. O que importa e o conteudo, nao a acentuacao.
 */
export function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
