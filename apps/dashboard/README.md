# Dashboard de telemetria

WebUI somente-leitura sobre o banco de telemetria do `@gba/ai-harness`. Mostra, dentro de uma
conversa, o que entrou e saiu de cada chamada de LLM, as chamadas de ferramenta, a entrada e a
saida do MCP, as decisoes do decider, o custo real cobrado pelo provedor e o tempo de cada etapa.

## Rodar

```bash
# 1. gere dados (roda o Agent contra um provedor simulado)
node scripts/seed-telemetry.mjs

# 2. suba a interface
pnpm dev     # http://127.0.0.1:3111
```

Aponte `TELEMETRY_DB_PATH` no `.env.local` para o banco que o seu agente escreve.

Para ver o bot do Telegram deste repo, que ja vem com a telemetria ligada:

```
TELEMETRY_DB_PATH=../../examples/telegram-bot/data/telemetry.db
```

## Ligar a telemetria no agente

```ts
const agent = Agent.create({
  apiKey: process.env.LLM_API_KEY,
  telemetry: { dbPath: '.harness/telemetry.db', app: 'meu-bot' },
});
```

Sem esse bloco nada e gravado e o agente se comporta exatamente como antes.

## Custo

O custo exibido e o que o provedor cobrou, lido do `usage.cost` que o OpenRouter devolve no
ultimo chunk do stream. Quando o provedor nao informa, a interface escreve "provedor nao
informou" — nunca estima e nunca mostra zero no lugar de desconhecido.

## Convencoes

Depois de rodar `shadcn add`, rode `pnpm format` na raiz: o `format:check` e o primeiro passo do
CI e o CLI emite aspas duplas.
