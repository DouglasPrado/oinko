import type { Agent, ContentPart } from '@oinko/core';

export interface AudioInput {
  kind: 'audio';
  audio: Uint8Array;
  filename: string;
  caption: string;
}

export type AgentInput = string | ContentPart[] | AudioInput;

export class TranscriptionError extends Error {
  constructor() {
    super(
      'Não consegui transcrever o áudio. Verifique o provedor de transcrição ou envie novamente.',
    );
  }
}

export interface ConversationRoute {
  channel: string;
  connectionId: string;
  conversationId: string;
}

export function threadIdFor(agentId: string, route: ConversationRoute): string {
  return JSON.stringify([agentId, route.channel, route.connectionId, route.conversationId]);
}

type AgentPort = Pick<Agent, 'chat' | 'transcribe' | 'clearHistory' | 'remember' | 'getUsage'>;

export const HELP =
  'Agente: envie uma mensagem de texto.\n/reset — limpar histórico desta conversa\n/memory <texto> — guardar uma memória desta conversa\n/usage — tokens usados nesta execução do aplicativo\n/help — ajuda';

export class AgentRuntime {
  // The SDK has mutable tool/skill state. Serialize turns across adapters,
  // including reset, so commands cannot race an active response.
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly agentId: string,
    private readonly agent: AgentPort,
  ) {}

  get name(): string {
    return this.agentId;
  }

  handle(route: ConversationRoute, input: AgentInput, signal?: AbortSignal): Promise<string> {
    return this.exclusive(async () => {
      signal?.throwIfAborted();
      if (typeof input === 'string') return this.execute(route, input.trim(), signal);
      let content: string | ContentPart[];
      if (Array.isArray(input)) content = input;
      else {
        let text: string;
        try {
          text = await this.agent.transcribe(input.audio, input.filename, { signal });
        } catch {
          throw new TranscriptionError();
        }
        if (!text.trim()) throw new TranscriptionError();
        content = input.caption ? `${input.caption}\n\n${text}` : text;
      }
      signal?.throwIfAborted();
      // Captions and spoken text are conversation content, not app commands.
      return this.agent.chat(content, { threadId: threadIdFor(this.agentId, route), signal });
    });
  }

  exclusive<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.pending.then(action);
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  async drain(): Promise<void> {
    await this.pending;
  }

  private async execute(
    route: ConversationRoute,
    text: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const threadId = threadIdFor(this.agentId, route);
    if (!text || text === '/help' || text === '/start') return HELP;
    if (text === '/reset') {
      this.agent.clearHistory(threadId);
      return 'Histórico desta conversa apagado. Memórias salvas foram mantidas.';
    }
    if (text === '/usage') return JSON.stringify(this.agent.getUsage(threadId), null, 2);
    if (/^\/memory(?:\s|$)/.test(text)) {
      const memory = text.slice('/memory'.length).trim();
      if (!memory) return 'Uso: /memory <texto para lembrar>';
      await this.agent.remember(memory, threadId);
      return 'Memória salva para esta conversa.';
    }
    return this.agent.chat(text, { threadId, signal });
  }
}

export { createAgentHost, type AgentHostConfig } from './host.js';
export type { AgentTool } from '@oinko/core';

export * from './connections.js';
export * from './control.js';
export * from './service.js';
