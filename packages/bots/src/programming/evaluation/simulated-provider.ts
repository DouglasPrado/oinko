import type { ScriptStep } from '@oinko/agent-runtime/programming';

interface Message {
  role: string;
  content: string | null;
}

/** Last tool result in the conversation, parsed (plain text results stay text). */
function lastResult(messages: readonly Message[]): unknown {
  const tool = messages.filter((message) => message.role === 'tool').at(-1);
  if (!tool) return undefined;
  try {
    return JSON.parse(String(tool.content));
  } catch {
    return tool.content;
  }
}

const REFERENCE = /^\{\{last\.([\w.[\]]+)\}\}$/;

/** Replaces `{{last.path}}` strings with values from the previous tool result. */
function resolve(value: unknown, last: unknown): unknown {
  if (typeof value === 'string') {
    const match = REFERENCE.exec(value);
    if (!match) return value;
    return match[1]!
      .split('.')
      .reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined), last);
  }
  if (Array.isArray(value)) return value.map((item) => resolve(item, last));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, last)]));
  return value;
}

/**
 * A deterministic model for the SIMULATED environment: an OpenRouter-shaped
 * SSE endpoint that replays the case's steps in order, reading references
 * such as a file hash from the previous tool result like a model would.
 * Usage is reported without cost, so cost stays "unknown", never zero.
 */
export function simulatedProvider(steps: readonly ScriptStep[]): {
  fetch: (request: Request) => Promise<Response>;
  requests: { model: string; messages: Message[] }[];
} {
  let index = 0;
  let call = 0;
  const requests: { model: string; messages: Message[] }[] = [];
  const fetch = async (request: Request) => {
    const body = (await request.json()) as { model: string; messages: Message[] };
    requests.push(body);
    call++;
    const step: ScriptStep = steps[index] ? steps[index++]! : { text: 'Aguardando avaliação.' };
    const frames =
      'tool' in step
        ? [
            { id: `sim-${call}`, choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${call}`, function: { name: step.tool, arguments: JSON.stringify(resolve(step.args, lastResult(body.messages))) } }] }, index: 0 }] },
            { choices: [{ finish_reason: 'tool_calls', index: 0 }] },
            { choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } },
          ]
        : [
            { id: `sim-${call}`, choices: [{ delta: { content: step.text }, index: 0 }] },
            { choices: [{ finish_reason: 'stop', index: 0 }] },
            { choices: [], usage: { prompt_tokens: 80, completion_tokens: 8, total_tokens: 88 } },
          ];
    return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
  return { fetch, requests };
}
