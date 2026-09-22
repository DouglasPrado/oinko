import { cn } from '@/lib/utils/cn';

interface Message {
  role?: unknown;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: unknown;
}

const ROLE_TONE: Record<string, string> = {
  system: 'text-ink-muted',
  user: 'text-ink',
  assistant: 'text-time',
  tool: 'text-judge',
};

/** Reconhece o corpo de uma chamada de chat: a forma que o SDK envia ao modelo. */
export function parseMessages(text: string): Message[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const messages = parsed as Message[];
  const looksRight = messages.every(
    (message) =>
      typeof message === 'object' && message !== null && typeof message.role === 'string',
  );

  return looksRight ? messages : null;
}

function contentOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        const typed = part as { type?: string; text?: string };
        if (typed.type === 'text' && typeof typed.text === 'string') return typed.text;
        return `[${typed.type ?? 'parte'}]`;
      })
      .join('\n');
  }
  return JSON.stringify(content);
}

/**
 * O prompt como conversa, nao como JSON.
 *
 * E a forma em que a entrada de uma chamada de LLM e de fato lida: quem falou
 * o que, em ordem. O JSON continua a um clique, para quando a estrutura e que
 * importa.
 */
export function MessageList({ messages }: { messages: Message[] }) {
  return (
    <ol className="divide-y divide-rule/60">
      {messages.map((message, index) => {
        const role = typeof message.role === 'string' ? message.role : 'desconhecido';
        const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

        return (
          <li key={index} className="px-3 py-2">
            <p className={cn('text-[0.6875rem]', ROLE_TONE[role] ?? 'text-ink-muted')}>{role}</p>
            <p className="mt-0.5 max-w-[70ch] text-xs leading-relaxed whitespace-pre-wrap">
              {contentOf(message.content)}
            </p>
            {calls.map((call, callIndex) => {
              const typed = call as { function?: { name?: string; arguments?: string } };
              return (
                <p key={callIndex} className="mt-1 font-mono text-xs text-judge">
                  → {typed.function?.name ?? 'tool'}({typed.function?.arguments ?? ''})
                </p>
              );
            })}
          </li>
        );
      })}
    </ol>
  );
}
