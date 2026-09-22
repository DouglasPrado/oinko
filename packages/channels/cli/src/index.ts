import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { controlRequest, type ChannelProvider, type AgentRuntime } from '@oinko/agent-runtime';

export async function runCli(
  runtime: Pick<AgentRuntime, 'name' | 'handle'>,
  sessionId: string,
  signal: AbortSignal,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): Promise<void> {
  const terminal = input === process.stdin && Boolean(process.stdin.isTTY);
  const reader = createInterface({ input, output, terminal });
  const close = () => reader.close();
  signal.addEventListener('abort', close, { once: true });
  if (signal.aborted) reader.close();
  output.write(`${runtime.name} · CLI · /help para ajuda · /exit para sair\n`);
  if (terminal) {
    reader.setPrompt('Você > ');
    reader.prompt();
  }
  try {
    for await (const line of reader) {
      if (signal.aborted || line.trim() === '/exit') break;
      if (!line.trim()) {
        if (terminal) reader.prompt();
        continue;
      }
      try {
        const answer = await runtime.handle(
          { channel: 'cli', connectionId: 'local', conversationId: sessionId },
          line,
          signal,
        );
        output.write(`${runtime.name} > ${answer || '(sem resposta textual)'}\n`);
      } catch {
        if (!signal.aborted) output.write('Não consegui concluir a resposta. Tente novamente.\n');
      }
      if (terminal && !signal.aborted) reader.prompt();
    }
  } finally {
    signal.removeEventListener('abort', close);
    reader.close();
  }
}

export const cliChannel: ChannelProvider = async (_options, context) => {
  if (context.signal.aborted) return;
  context.ready();
  await new Promise<void>((resolve) =>
    context.signal.addEventListener('abort', () => resolve(), { once: true }),
  );
};

export async function attachCli(
  socketPath: string,
  sessionId: string,
  signal: AbortSignal,
  connectionId = 'local',
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): Promise<void> {
  const status = await controlRequest<{ agentId: string }>(
    socketPath,
    '/status',
    undefined,
    signal,
  );
  await runCli(
    {
      name: status.agentId,
      async handle(_route, text, requestSignal) {
        const result = await controlRequest<{ answer: string }>(
          socketPath,
          '/message',
          { connectionId, sessionId, text },
          requestSignal,
        );
        return result.answer;
      },
    },
    sessionId,
    signal,
    input,
    output,
  );
}
