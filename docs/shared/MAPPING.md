# Indice Mestre de Rastreabilidade

> Mapa completo mostrando como informacao flui do PRD para implementacao. Use para rastrear qualquer decisao ate sua origem.

---

## Fluxo de Dados

```
PRD (docs/prd.md)
  │
  ▼
Blueprint Tecnico (docs/blueprint/)     ← FONTE PRIMARIA
  │
  ├──► Backend (docs/backend/)          ← Implementacao server
  ├──► Frontend (docs/frontend/)        ← Implementacao client
  ├──► Business (docs/business/)        ← Modelo de negocio
  └──► Shared (docs/shared/)            ← Conectores cross-suite
         ├── glossary.md                ← Termos unicos
         ├── event-mapping.md           ← Backend eventos → Frontend estado
         ├── error-ux-mapping.md        ← Backend erros → Frontend UX
         └── MAPPING.md                 ← Este arquivo
```

---

## Mapeamento Blueprint → Backend

Contexto adaptativo: `docs/blueprint/26-adaptive-context.md` → `packages/oinko/src/core/{adaptive-context,working-context,context-summary-writer}.ts`, seleção em `tools/tool-selection.ts`, consulta em `tools/builtin/tool-result.ts`, armazenamento em `ConversationStore`/SQLite. Configuração compartilhada por `packages/bots`, dashboard e MCP Oinko. Regressões: `working-context.test.ts`, `tool-selection.test.ts`, `09-adaptive-context.test.ts`, `decision-usage.test.ts`, `context-policy.spec.ts`. Avaliação real repetível: `packages/oinko/scripts/context-evaluation/`.

Telemetria por bot: `docs/dashboard/PLAN.md` → `apps/dashboard/src/server/repositories/telemetry-sources.ts` e `features/telemetry`. Regressões de isolamento e navegação: `tests/unit/telemetry-sources.test.ts` e `tests/e2e/telemetry-bots.spec.ts` na dashboard.

Bots configuráveis: `docs/dashboard/PLAN.md` → `packages/bots` e `apps/dashboard/src/server/bots`. Histórico e isolamento: `packages/agent-runtime/tests`; CLI e ciclo de serviço: `packages/channels/cli/tests`; texto, imagem e áudio Telegram: `packages/channels/telegram/tests`. Cada bot usa `.harness/bots/<id>` e o executor compartilhado.

Espera no Telegram: `docs/dashboard/PLAN.md` → `packages/channels/telegram/src/typing.ts`; testes do adaptador verificam renovação, encerramento, cancelamento e tolerância a falhas da indicação.

MCP local nos bots: `docs/dashboard/PLAN.md` e `docs/blueprint/25-oinko-mcp.md` → schema e runner de `packages/bots`; regressão em `packages/bots/tests/bots.test.ts` conecta o servidor Oinko real pelo worker e preserva conexões HTTP existentes.

Projetos e ambientes: `docs/blueprint/24-workspaces-environments.md` → `packages/workspaces`, `packages/environments`, `apps/environment-runner`, ferramentas em `packages/bots/src/programming-tools.ts` e telas `apps/dashboard/src/features/{projects,environments}`. Decisão: `docs/adr/adr-008-local-environments.md`. Operação: `packages/environments/README.md`. Evidências: `docs/dashboard/ENVIRONMENTS-DELIVERY.md`.

Trabalhos de programação duráveis: `docs/blueprint/27-programming-runs.md` e `docs/milestones/programming-agents/` → núcleo em `packages/agent-runtime/src/programming/` (`contracts`, `state`, `policy`/`policy-schema`, `store/`, `telemetry/`, `operations`, `artifacts`, `usage`, `evidence`, `service`, `agent-executor`, `channel`, `notifier`, `delivery-report`, `evaluation/`, `validation`); ferramentas e composição por bot em `packages/bots/src/programming/` (`run-tools`, `delivery-tools`, `reconciler`, `runtime`, `models`, `audit`, `equivalence`, `evaluation/`) e `packages/bots/src/runner.ts`; runner em `packages/environments/src/{workspace,browser,publication}/` e `runtime/extensions.ts`; SDK (correlação, fallback por latência, resumo em segundo plano, seleção progressiva) em `packages/oinko/src/{agent.ts,core/react-loop.ts,core/working-context.ts,tools/tool-selection.ts}`; interfaces em `apps/dashboard/src/features/{programming,evaluation,bots/programming-settings.tsx,projects/programming-settings.tsx}`, `packages/mcps/oinko/src/runs.ts` e `packages/channels/telegram`. Regressões: `packages/agent-runtime/tests/programming/*`, `packages/bots/tests/{programming-run,delivery,evaluation,pilot,models}.test.ts`, Docker em `packages/bots/tests/{programming,evaluation}.e2e.test.ts` e `packages/environments/tests/{workspace,browser,publication-docker}.e2e.test.ts`, UI em `apps/dashboard/tests/e2e/programming.spec.ts`. Operação: `docs/milestones/programming-agents/RUNBOOK.md`; validação: `pnpm validate:programming` e `docs/milestones/programming-agents/reports/`.

Navegação da dashboard: `docs/dashboard/PLAN.md` → `apps/dashboard/src/components/shell/{workbench,dashboard-shell,thread-rail}.tsx` e `components/shared/product-nav.tsx`. Regressões de navegação entre seções e menu móvel: `apps/dashboard/tests/e2e/navigation.spec.ts`.

| Blueprint | Backend | O que flui |
| --- | --- | --- |
| 00-context.md | 13-integrations.md | Sistemas externos → clients de API |
| 01-vision.md | 00-backend-vision.md | Metricas, nao-objetivos |
| 02-architecture_principles.md | 00-backend-vision.md | Principios de design |
| 03-requirements.md | 05-api-contracts.md, 10-validation.md | RF → endpoints; RNF → metricas |
| 04-domain-model.md | 03-domain.md, 10-validation.md | Entidades → classes; Regras → validacoes |
| 05-data-model.md | 04-data-layer.md | Tabelas → repositories; Queries → indices |
| 06-system-architecture.md | 01-architecture.md, 08-middlewares.md | Componentes → camadas; Deploy → infra |
| 07-critical_flows.md | 06-services.md, 09-errors.md | Fluxos → metodos de service; Erros → catalogo |
| 08-use_cases.md | 05-api-contracts.md, 11-permissions.md | UCs → endpoints; Atores → RBAC |
| 09-state-models.md | 03-domain.md | Estados → maquinas de estado nas entidades |
| 10-architecture_decisions.md | 00-backend-vision.md, 01-architecture.md | ADRs → justificativas de stack |
| 11-build_plan.md | — | Ordem de implementacao |
| 12-testing_strategy.md | 14-tests.md | Piramide → ferramentas e cenarios |
| 13-security.md | 08-middlewares.md, 11-permissions.md | Auth → middleware; RBAC → matriz |
| 14-scalability.md | 08-middlewares.md | Cache, rate limit → config de middleware |
| 15-observability.md | 08-middlewares.md | Logs, traces → pipeline de request |
| 16-evolution.md | 05-api-contracts.md | Versionamento API |
| 17-communication.md | 12-events.md, 13-integrations.md | Canais → workers; Provedores → clients |

---

## Mapeamento Blueprint → Frontend

| Blueprint | Frontend | O que flui |
| --- | --- | --- |
| 00-context.md | 00-frontend-vision.md | Atores → personas do frontend |
| 01-vision.md | 00-frontend-vision.md | Problema → contexto do frontend |
| 02-architecture_principles.md | 01-architecture.md | Principios → camadas do frontend |
| 03-requirements.md | 09-tests.md, 10-performance.md | RNF → Core Web Vitals, cobertura |
| 04-domain-model.md | 03-design-system.md, 04-components.md | Entidades → componentes de UI |
| 05-data-model.md | 06-data-layer.md | Schema → DTOs e API client |
| 06-system-architecture.md | 01-architecture.md, 13-cicd-conventions.md | Deploy → CI/CD frontend |
| 07-critical_flows.md | 08-flows.md | Fluxos sistema → fluxos de UI |
| 08-use_cases.md | 07-routes.md, 04-components.md | UCs → telas/rotas |
| 09-state-models.md | 05-state.md | Estados → stores do frontend |
| 13-security.md | 11-security.md | Auth → protecao de rotas |
| 14-scalability.md | 10-performance.md | Cache → estrategia client-side |
| 15-observability.md | 12-observability.md | Metricas → error tracking frontend |
| 17-communication.md | 14-copies.md | Templates → copies e mensagens |
| backend/05-api-contracts.md | 15-api-dependencies.md | Endpoints → dependencias consumidas pelo frontend |

---

## Mapeamento Blueprint → Business

| Blueprint | Business | O que flui |
| --- | --- | --- |
| 00-context.md | 00-business-context.md | Atores → mercado, segmento |
| 01-vision.md | 01-value-proposition.md, 05-revenue-model.md | Problema → proposta de valor |
| 03-requirements.md | 05-revenue-model.md | Features → pricing tiers |
| 06-system-architecture.md | 06-cost-structure.md, 09-operational-plan.md | Infra → custos; Deploy → operacoes |
| 11-build_plan.md | 09-operational-plan.md | Fases → timeline operacional |
| 14-scalability.md | 06-cost-structure.md | Escala → projecao de custos |
| 15-observability.md | 07-metrics-kpis.md | Metricas tecnicas → KPIs de negocio |
| 17-communication.md | 03-channels-distribution.md, 04-relationships.md | Canais → distribuicao e relacionamento |

---

## Documentos Compartilhados (Cross-Suite)

| Documento | Conecta | Proposito |
| --- | --- | --- |
| `shared/glossary.md` | Todos | Termos unicos do dominio |
| `shared/event-mapping.md` | Backend 12 ↔ Frontend 05/06/08 | Eventos → estado e fluxos do frontend |
| `shared/error-ux-mapping.md` | Backend 09 ↔ Frontend 11/12 | Erros → resposta visual |

Administração de bots pelo MCP: `docs/blueprint/25-oinko-mcp.md` → `packages/mcps/oinko/src/bots.ts`; regressões de patch, revisão, credenciais e processo ativo em `packages/mcps/oinko/tests/bots.test.ts`.

Jev nos bots: `docs/dashboard/PLAN.md` → schema/store/runner de `packages/bots`; `tests/intelligence.test.ts` verifica roteamento OpenRouter, credenciais separadas, fallback e registro na telemetria.
