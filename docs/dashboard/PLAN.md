# Oinko Dashboard — Plano de Implementação

> App companion para configurar o AI Harness SDK (`@gba/ai-harness`) por interface,
> testar a configuração num playground e acompanhar uso. **Não faz parte do pacote
> publicado no npm.**

**Status:** **NÃO DECIDIDO — opção registrada, não construir por enquanto.**
**Data:** 2026-09-21

---

## 0. Por que este plano está parado

Levantado o custo contra os consumidores reais do SDK (`examples/telegram-bot`,
`examples/teams-bot`), a conclusão foi **não construir agora**. Os dados:

- O que varia de verdade entre bots é `systemPrompt` (~60 linhas no teams-bot),
  tools, skills e queries SQL. Desses, só o prompt caberia num formulário — o resto
  é TypeScript e vai continuar sendo.
- Os campos que um configurador editaria bem (`maxIterations`, `samplingRate`,
  `costPolicy`, `chunkSize`) são definidos uma vez no factory e quase nunca tocados.
  O schema tem ~25 campos; o factory do telegram-bot usa 12; o mínimo real é 1.
- O custo é um segundo produto: auth própria, ~300 deps transitivas num repo cuja
  identidade é ter 1, deploy/updates de Next e uma superfície de RCE (MCP stdio)
  que hoje não existe — tudo isso sem CI no repo.
- Quem edita config hoje são devs com acesso ao repositório. Para esse público,
  editar `agent-factory.ts` é mais rápido que qualquer UI.

**Gatilhos para reabrir este plano** (qualquer um deles):

1. Alguém sem acesso ao repo pedir ajuste de prompt/modelo mais de uma vez por semana.
2. Passar de ~5 perfis de agente distintos em produção.
3. Um cliente externo precisar configurar o próprio agente (aí o recorte é
   multi-tenant, e boa parte deste plano muda).
4. Debug de tool calls em produção virar rotina — nesse caso o recorte certo é
   observabilidade, **não** configuração.

Se reabrir, o escopo a considerar primeiro é o menor útil — "console do prompt"
(editar `systemPrompt` + playground + threads), que é cerca de um terço do que está
descrito abaixo e dispensa CRUD de configuração.

---

## 1. Restrições que moldam o desenho

| Restrição | Origem | Consequência |
| --------- | ------ | ------------ |
| UI/frontend e API HTTP estão **fora de escopo** do SDK | `docs/blueprint/18-scope.md:41-42` | A dashboard é um app separado dentro do workspace; nada dela entra em `dist/` |
| SDK aceita no máximo 4 dependências diretas | `CLAUDE.md` § Stack | Next.js, React etc. ficam **só** no `package.json` do app |
| Persistência é `node:sqlite` (Node 22.5+) | `CLAUDE.md`, `src/storage/sqlite-database.ts` | A dashboard usa o mesmo módulo embutido, sem ORM e sem dep nativa |
| Validação só com Zod 4 | `CLAUDE.md` § Stack | Os formulários derivam do próprio `AgentConfigSchema` — schema é fonte de verdade |
| `Agent` roda in-process e abre SQLite | `src/agent.ts:166` | Route handlers em runtime **nodejs** (nunca edge) e pool de instâncias com `destroy()` |

**Decisões tomadas:** MVP = config + playground + uso · código em `apps/dashboard` no
mesmo repo · Next.js 15 (App Router) · auth local em SQLite.

---

## 2. Arquitetura

```
oinko/
├── src/                          # SDK — permanece intocado (salvo o gap G-3)
├── apps/
│   └── dashboard/                # private: true, nunca publicado
│       ├── src/app/
│       │   ├── (public)/login/
│       │   ├── (app)/profiles/[id]/     # editor de AgentConfig
│       │   ├── (app)/playground/        # chat streaming
│       │   ├── (app)/threads/           # histórico de conversas
│       │   ├── (app)/usage/             # tokens e custo
│       │   └── api/playground/stream/route.ts   # SSE, runtime: 'nodejs'
│       ├── src/lib/
│       │   ├── auth/      # scrypt, sessão, guard
│       │   ├── db/        # node:sqlite + migrations da dashboard
│       │   ├── profiles/  # schema persistido, cifra de segredos
│       │   └── agent/     # pool de Agents, SSE, hook de uso
│       ├── src/middleware.ts
│       └── scripts/create-user.ts
└── pnpm-workspace.yaml           # ganha packages: ['.', 'apps/*']
```

- `apps/dashboard` depende de `"@gba/ai-harness": "workspace:*"`. Como a raiz aponta
  `main` para `dist/`, o `dev` do app roda `pnpm --filter @gba/ai-harness build`
  antes (script `predev`/`prebuild`).
- Dois bancos, de propósito: `.harness/data.db` continua sendo do SDK (`memories`,
  `vectors`, `conversations`) e a dashboard tem o seu `dashboard.db`
  (`users`, `sessions`, `agent_profiles`, `runs`, `audit_log`). Misturar acoplaria
  as migrations da dashboard ao `migrateV1` do SDK. A dashboard **lê** o db do
  agente, e só escreve nele por meio da API do `Agent`.

---

## 3. Modelo de dados (`dashboard.db`)

| Tabela | Colunas-chave | Papel |
| ------ | ------------- | ----- |
| `users` | `id`, `email`, `password_hash`, `role`, `created_at` | Sem signup público; admin criado por script |
| `sessions` | `id`, `user_id`, `token_hash`, `expires_at`, `created_at`, `user_agent` | Guarda **hash** do token, nunca o token |
| `agent_profiles` | `id`, `slug`, `name`, `config_json`, `version`, `updated_at`, `updated_by` | Um perfil = uma `AgentConfig` serializável |
| `agent_profile_versions` | `profile_id`, `version`, `config_json`, `created_at`, `author` | Histórico e rollback de configuração |
| `secrets` | `id`, `profile_id`, `key`, `mode` (`env`\|`encrypted`), `value_enc`, `iv` | `apiKey` e afins — ver § 5 |
| `runs` | `id`, `profile_id`, `thread_id`, `model`, `input_tokens`, `output_tokens`, `duration_ms`, `cost_cents`, `created_at` | Uso persistido (o SDK não persiste — gap G-2) |
| `model_prices` | `model`, `input_per_1m`, `output_per_1m`, `updated_at` | Tabela de preços editável, para estimar custo |
| `audit_log` | `id`, `user_id`, `action`, `target`, `created_at` | Quem mudou o quê (config é material sensível) |

---

## 4. Config persistida — o ponto central

`AgentConfigSchema` tem campos que **não serializam**: `fetch`, `conversation.store`,
`knowledge.store` (todos `z.custom`). O que a dashboard persiste é um subset:

```ts
// apps/dashboard/src/lib/profiles/schema.ts
export const PersistedAgentConfigSchema = AgentConfigSchema
  .omit({ apiKey: true, fetch: true, conversation: true })
  .extend({ knowledge: KnowledgeConfigSchema.omit({ store: true }).optional() });
```

Regras:

1. **O schema do SDK é a fonte de verdade da UI.** Labels, ranges, enums e
   placeholders de default saem do próprio Zod (`.shape.x`, `_def.defaultValue()`),
   então um campo novo no SDK aparece na dashboard sem edição manual.
2. Formulários com `react-hook-form` + `@hookform/resolvers/zod`, mesma major do
   Zod do SDK (4.x) — versões divergentes quebram o resolver silenciosamente.
3. Um perfil salvo é sempre revalidado no servidor antes do `INSERT`. A UI nunca é
   a única barreira.
4. Consumo pelo app real (ex.: `examples/telegram-bot`): loader que lê o perfil por
   `slug` e devolve um `AgentConfigInput`, injetando `apiKey` e stores em código.
   No MVP o consumidor lê no boot; hot-reload por `version` fica para depois.

---

## 5. Segredos e segurança

- `apiKey` **não** vai no `config_json`. Dois modos: referência a variável de
  ambiente (padrão) ou valor cifrado com AES-256-GCM (`node:crypto`) usando
  `DASHBOARD_SECRET_KEY`. Nunca devolvido em claro por nenhuma rota — a UI mostra
  só os 4 últimos caracteres.
- **MCP stdio é execução remota de código.** Um formulário que aceita `command` +
  `args` arbitrários transforma a dashboard num shell. Mitigação obrigatória:
  `allowedStdioCommands` preenchido no servidor (nunca pelo cliente), ação restrita
  a `role=admin`, e o transporte `stdio` desligado por padrão quando a dashboard
  não estiver em `localhost`.
- Ferramentas builtin (`bash`, `file-write`) habilitadas no playground herdam esse
  risco — no MVP o playground roda com um conjunto de tools explicitamente
  autorizado por perfil.
- LGPD: só armazenamos email e hash de senha. `audit_log` e `runs` guardam
  identificadores, não conteúdo de mensagem; o conteúdo já vive no db do agente.
  Definir retenção antes de subir para um servidor compartilhado.

---

## 6. Auth local

- Senha com `scrypt` do `node:crypto` (N=2^15, salt de 16 bytes) — evita dep nativa
  tipo argon2 e mantém a filosofia de poucas dependências.
- Token de sessão: 32 bytes aleatórios; o cookie leva o token, o banco guarda o
  hash. Cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção, expiração de 7 dias
  com renovação deslizante.
- `middleware.ts` protege tudo fora de `/login`; a verificação real de sessão
  (SQLite) roda em Server Component/Action, porque o middleware do Next não tem
  acesso a `node:sqlite`.
- Rate limit por IP e bloqueio temporário após 5 tentativas.
- Primeiro admin: `pnpm --filter dashboard create-user`. Sem cadastro aberto.

---

## 7. Playground (streaming)

- `POST /api/playground/stream` com `export const runtime = 'nodejs'`, devolvendo
  `ReadableStream` em SSE a partir de `agent.stream()`.
- **Pool de Agents**: `Agent.create()` abre SQLite e carrega skills — criar um por
  request vaza recursos. LRU por `(profileId, userId)` com `destroy()` no despejo e
  no shutdown; `AbortSignal` do request ligado ao `signal` do `stream()`.
- **Serialização de eventos**: `ErrorEvent.error` é um `Error` e vira `{}` em
  `JSON.stringify`. Todo `AgentEvent` passa por um mapeador para DTO na borda
  (gap G-4). Os 18 tipos de evento (`src/contracts/entities/agent-event.ts`) viram
  elementos visuais: `text_delta` no balão, `tool_call_start/end` em accordion,
  `compaction`/`model_fallback`/`recovery` em timeline lateral, `error` em destaque.
- Um `turnEndHook` grava a linha em `runs` ao fim de cada turno.

---

## 8. Gaps do SDK identificados

| ID | Gap | Encaminhamento |
| -- | --- | -------------- |
| G-1 | `ConversationStore` não tem `listThreads()` (`src/contracts/entities/stores.ts:19`) | MVP: `SELECT DISTINCT thread_id` direto no db do agente (read-only). Follow-up: método opcional na interface |
| G-2 | `getUsage()` é acumulador em memória, perdido no restart (`src/agent.ts:716`) | Dashboard persiste via `addTurnEndHook` na tabela `runs` |
| G-3 | Sub-schemas (`KnowledgeConfigSchema`, `MemoryConfigSchema`, `SkillsConfigSchema`, `CostPolicySchema`, `MCPConnectionConfigSchema`) não são exportados — só os tipos | Mudança aditiva no SDK: exportá-los em `src/index.ts`. Sem isso, a dashboard depende de `AgentConfigSchema.shape.knowledge.unwrap()`, que é frágil |
| G-4 | `ErrorEvent.error: Error` não é serializável | Mapeador de evento → DTO na borda SSE |
| G-5 | A tabela `memories` é criada em `migrateV1` mas ninguém lê nem escreve nela — memória hoje é file-based em `.harness/memory/*.md` | A tela de memórias (fase 2) edita **arquivos** via `FileMemorySystem`. Vale decidir se a tabela sai do schema |

---

## 9. Fases

| Fase | Entrega | Pronto quando |
| ---- | ------- | ------------- |
| **0 — Fundação** | `pnpm-workspace.yaml` com `apps/*`, scaffold Next.js 15, `dashboard.db` + migrations, layout base | `pnpm --filter dashboard dev` sobe e o build do SDK continua limpo |
| **1 — Auth** | scrypt, sessões, `middleware.ts`, `/login`, `create-user`, rate limit, `audit_log` | Rota protegida redireciona, sessão expira, senha errada trava após 5 tentativas |
| **2 — Perfis** | CRUD de `agent_profiles`, formulário derivado do Zod, versionamento, cofre de segredos, loader para o consumidor | Um perfil criado na UI roda no `examples/telegram-bot` sem edição de código |
| **3 — Playground** | Rota SSE, pool de Agents, render dos 18 eventos, seletor de perfil e de tools | Conversa com tools e compactação renderiza sem travar, `destroy()` confirmado no fim |
| **4 — Uso** | `runs`, `model_prices`, telas de threads e de custo | Custo por perfil/dia bate com o `usage` do turno |
| **5 — Pós-MVP** | Ingest de knowledge (upload), editor de memória em arquivo, health de MCP, multiusuário/RBAC | — |

Cada fase segue o ciclo do repo (RED → GREEN → REFACTOR) e fecha em commit próprio.

## 10. Testes

- Vitest para o que é lógica pura: hash/verificação de senha, ciclo de vida de
  sessão, serialização do config persistido, mapeador de eventos, cálculo de custo.
- Playwright (dep de dev **só** do app) para login e um turno de playground.
- Atenção: este repo não tem CI (`CLAUDE.md` § "O que mudou ao sair do monorepo").
  Os testes do app precisam entrar no mesmo `pnpm test` da raiz ou ninguém roda.

## 11. Decisões em aberto

| ID | Questão | Por que importa |
| -- | ------- | --------------- |
| D-01 | A dashboard roda só em localhost ou vai para um servidor? | Define se `apiKey` fica cifrada no banco e se MCP stdio pode existir |
| D-02 | O app consumidor recarrega config sem restart? | Muda o loader (poll por `version` vs leitura no boot) |
| D-03 | Um perfil por bot ou perfis compartilhados entre consumidores? | Afeta a modelagem de `agent_profiles` e o RBAC futuro |
| D-04 | Design system: Tailwind + shadcn/ui ou CSS próprio? | Só afeta velocidade; nenhuma amarra arquitetural |
