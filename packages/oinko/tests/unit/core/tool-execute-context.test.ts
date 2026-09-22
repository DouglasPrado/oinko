import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { Agent } from '../../../src/agent.js';
import type { ToolExecuteContext } from '../../../src/contracts/entities/agent-tool.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Dois turnos: o primeiro pede a tool, o segundo responde em texto.
 *
 * Sem o segundo, o loop chamaria a tool e voltaria ao provedor esperando uma
 * resposta final que nunca viria.
 */
function mockProviderCallingTool(): void {
  const comTool =
    'data: {"id":"gen-1","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1",' +
    '"type":"function","function":{"name":"onde_estou","arguments":"{}"}}]}}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
    'data: [DONE]\n\n';
  const texto =
    'data: {"id":"gen-2","choices":[{"delta":{"content":"pronto"}}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
    'data: [DONE]\n\n';

  let chamada = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    const sse = chamada++ === 0 ? comTool : texto;
    return Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sse));
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
  });
}

describe('contexto de execucao da ferramenta', () => {
  it('entrega threadId, traceId e toolCallId a tool', async () => {
    mockProviderCallingTool();

    let visto: ToolExecuteContext | undefined;
    const agent = Agent.create({
      apiKey: 'sk-test-key-0123456789abcdef',
      memory: { enabled: false },
      knowledge: { enabled: false },
    });
    agent.addTool({
      name: 'onde_estou',
      description: 'Devolve o contexto que recebeu',
      parameters: z.object({}),
      execute: (_args, _signal, _onProgress, context) => {
        visto = context;
        return Promise.resolve('ok');
      },
    });

    for await (const _ of agent.stream('oi', { threadId: 'chat-42' })) {
      /* drain */
    }

    // O threadId e o que permite uma tool guardar estado por conversa — sem
    // ele, uma tool que le "a imagem desta conversa" nunca acha nada.
    expect(visto?.threadId).toBe('chat-42');
    expect(visto?.traceId).toMatch(/\S/);
    expect(visto?.toolCallId).toBe('call_1');

    await agent.destroy();
  });
});
