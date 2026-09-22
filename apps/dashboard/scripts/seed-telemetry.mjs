/**
 * Popula um banco de telemetria com execucoes realistas.
 *
 * Roda o Agent de verdade contra um provedor simulado, entao o que aparece na
 * dashboard passou pelo mesmo caminho que passaria em producao — incluindo a
 * captura de custo, os tempos e o registro de tool calls.
 *
 *   node apps/dashboard/scripts/seed-telemetry.mjs
 */
import { z } from 'zod';
import { Agent, TelemetryDatabase } from '@oinko/core';

const DB = '.harness/telemetry.db';

function sse(lines) {
  const text = lines.map((line) => `data: ${line}`).join('\n\n') + '\n\n' + 'data: [DONE]\n\n';
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

const usage = (prompt, completion, cost) =>
  JSON.stringify({
    choices: [],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
      ...(cost === null ? {} : { cost, cost_details: { upstream_inference_cost: cost * 0.92 } }),
      prompt_tokens_details: { cached_tokens: Math.floor(prompt * 0.4) },
    },
  });

const text = (content) =>
  JSON.stringify({
    id: 'gen-' + Math.random().toString(36).slice(2, 10),
    provider: 'Anthropic',
    choices: [{ delta: { content } }],
  });
const stop = () => JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] });
const toolCall = (name, args) =>
  JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_' + Math.random().toString(36).slice(2, 8),
              function: { name, arguments: args },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  });

/** Sequencia de respostas que o provedor simulado devolve, em ordem. */
let script = [];
let call = 0;

function fakeFetch() {
  const next = script[Math.min(call, script.length - 1)];
  call++;
  return Promise.resolve(sse(next));
}

/**
 * Decisor falso: responde o que o roteiro mandar, com confianca plausivel.
 *
 * Existe para a interface ter decisoes reais para renderizar sem depender de
 * uma chave da TypeSafe nem de chamada de rede.
 */
function fakeDecider() {
  return {
    decide: (_state, questions) =>
      Promise.resolve(
        Object.fromEntries(
          Object.entries(questions).map(([key, question]) => {
            if (question.kind === 'bool') {
              const value = key === 'jailbreak' ? false : Math.random() > 0.5;
              return [key, { value, confidence: 0.72 + Math.random() * 0.26 }];
            }
            if (question.kind === 'choice') {
              const options = Object.keys(question.criteria ?? { fast: '', capable: '' });
              return [
                key,
                {
                  value: options[Math.floor(Math.random() * options.length)],
                  confidence: 0.81,
                  probabilities: Object.fromEntries(options.map((o) => [o, 1 / options.length])),
                },
              ];
            }
            return [key, { value: 2, confidence: 0.9 }];
          }),
        ),
      ),
  };
}

async function run({ threadId, input, responses, model, app, baseUrl }) {
  script = responses;
  call = 0;

  const agent = Agent.create({
    apiKey: 'sk-seed-key-0123456789abcdef',
    model,
    ...(baseUrl !== undefined && { baseUrl }),
    memory: { enabled: false },
    knowledge: { enabled: false },
    telemetry: { dbPath: DB, app },
    decider: fakeDecider(),
    jailbreak: { mode: 'warn' },
    fetch: fakeFetch,
  });

  agent.addTool({
    name: 'buscar_pedido',
    description: 'Busca um pedido pelo numero',
    parameters: z.object({ numero: z.string() }),
    execute: async ({ numero }) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return JSON.stringify({
        numero,
        status: 'em transporte',
        previsao: '2026-09-25',
        transportadora: 'Correios',
      });
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const event of agent.stream(input, { threadId })) {
    // O stream precisa ser drenado ate o fim para o turno fechar.
  }
  await agent.destroy();
}

// Limpa as tabelas em vez de apagar o arquivo: a dashboard mantem a conexao
// aberta, e trocar o arquivo por baixo dela deixaria o servidor lendo um inode
// que nao existe mais — 404 em tudo ate reiniciar.
const database = new TelemetryDatabase(DB);
database.initialize();
for (const table of [
  'events',
  'decisions',
  'mcp_calls',
  'tool_calls',
  'llm_call_injections',
  'llm_calls',
  'executions',
  'payloads',
]) {
  database.db.exec(`DELETE FROM ${table}`);
}
database.close();

console.log('semeando telemetria em', DB);

await run({
  threadId: 'suporte-4821',
  app: 'telegram-bot',
  model: 'anthropic/claude-sonnet-5',
  input: 'Oi, meu pedido 99213 ainda nao chegou. O que aconteceu?',
  responses: [
    [toolCall('buscar_pedido', '{"numero":"99213"}'), usage(2480, 38, 0.0041)],
    [
      text(
        'Seu pedido 99213 esta em transporte pelos Correios, com previsao de entrega em 25/09. ',
      ),
      text('Ele saiu do centro de distribuicao ontem a noite.'),
      stop(),
      usage(3120, 96, 0.0067),
    ],
  ],
});

await run({
  threadId: 'suporte-4821',
  app: 'telegram-bot',
  model: 'anthropic/claude-sonnet-5',
  input: 'E se nao chegar ate sexta?',
  responses: [
    [
      text('Se nao chegar ate sexta, abro um chamado de extravio para voce. '),
      text('Quer que eu ja deixe preparado?'),
      stop(),
      usage(3460, 54, 0.0048),
    ],
  ],
});

await run({
  threadId: 'vendas-1190',
  app: 'teams-bot',
  model: 'openai/gpt-6-astra',
  input: 'Quanto custa o plano anual?',
  responses: [
    [
      text('O plano anual sai por R$ 1.188, com dois meses gratis em relacao ao mensal.'),
      stop(),
      usage(890, 42, 0.0012),
    ],
  ],
});

// Provedor sem API de custo: nao ha o que confirmar depois, entao a interface
// precisa dizer "indisponivel" — e nunca zero.
await run({
  threadId: 'interno-0007',
  app: 'cli',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  input: 'Resuma o relatorio trimestral',
  responses: [
    [
      text('O trimestre fechou com crescimento de 12% em receita recorrente.'),
      stop(),
      usage(1240, 31, null),
    ],
  ],
});

console.log('pronto. abra a dashboard com: pnpm -F @oinko/dashboard dev');
