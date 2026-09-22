import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { AgentRuntime } from '@oinko/agent-runtime';

export async function runCli(
  runtime: AgentRuntime,
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
