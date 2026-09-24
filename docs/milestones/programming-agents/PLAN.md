# Plano de execução

**Status:** in_progress. **Início:** 24/09/2026. **Branch:** `feat/programming-agents`, empilhada sobre `feat/dashboard-redesign` (PR #7 aberto), porque M04 constrói telas sobre a navegação nova. Nenhum push, PR, merge ou alteração de configuração de bots reais é feito por esta execução.

[Voltar ao plano](README.md) · [Arquitetura](ARCHITECTURE.md) · [Telemetria](TELEMETRY.md) · [Validação](VALIDATION.md) · [Blueprint 27](../../blueprint/27-programming-runs.md)

## Decisões de localização (M00)

| Capacidade | Local | Motivo |
| --- | --- | --- |
| Contratos, estados, políticas, run store, telemetria de run, uso, artefatos, fila, executor, recuperação, avaliação | `packages/agent-runtime/src/programming/` | Runtime já é dono do ciclo de vida; depende só de `@oinko/core`, `@oinko/workspaces/contracts` e Zod. Sem Docker, UI ou GitHub. |
| Configuração de programação do bot | `packages/bots/src/schema.ts` (`programmingPolicy`) reusando `ProgrammingPolicySchema` do runtime | Mesmo schema na dashboard, MCP e worker; `programming: boolean` continua compatível. |
| Configuração de programação do projeto | `packages/workspaces/src/contracts` (`ProjectSchema.programming`) | Projeto é a unidade de autorização; campo opcional preserva cadastros antigos. |
| Busca, leitura por intervalo, replace, patch, instruções, comandos, diff, checks | `packages/environments/src/workspace/` + comandos do runner | Executam dentro do container do projeto; o bot nunca toca o filesystem do host. |
| Browser isolado e política de rede | `packages/environments/src/browser/` | Fora do SDK; o runner é o único controlador de Docker. |
| GitHub App e publicação | `packages/environments/src/publication/` com executor em processo separado | Porta própria; Git autenticado roda num espelho do runner, nunca na worktree do agente. |
| Correlação e fallback por latência | `packages/oinko` (genérico: `correlation`, `latencyFallback`) | SDK continua sem conhecer bot, projeto ou Docker. |
| Interfaces | dashboard, `packages/channels/*`, `packages/mcps/oinko` | Mesmo `ProgrammingRunService` e mesmas verificações de permissão. |

Banco: `.harness/programming.db` (SQLite WAL, migrações versionadas). Compartilhado por bots para serializar worktrees; toda consulta é filtrada por identidade e autorização. Eventos de run ficam no journal/outbox desse banco e são entregues, com deduplicação, à tabela `telemetry_events` do `telemetry.db` de cada bot (migração v3 do SDK).

## Ordem de execução

1. **M00** contratos + máquina de estados + políticas + migrações/backup + cenários congelados/baseline simulado.
2. **M01** envelope/spans/catálogo, journal/outbox/recibos, captura/redaction/artefatos/retenção, uso/tempos, consulta paginada.
3. **M02** operações de workspace no runner (search/range/replace/patch/instruções/comandos/diff/checks) e ferramentas dos bots.
4. **M03** store de runs, fila por bot, ciclos com progresso verificável, lease/reconciliação, controles, orientação e aceite.
5. **M04** dashboard (config + trabalhos), Telegram/CLI (controles e notificações), MCP (runs e telemetria).
6. **M05** container de browser, proxy de egress, ações e verificação funcional ligada à revisão.
7. **M06** GitHub App, publicação isolada, draft PR idempotente, CI por polling.
8. **M07** resumo em background, seleção progressiva, fallback fast → principal em 15 s, comparação por bot.
9. **M08** dataset/harness, diagnóstico, candidatos/promoção/rollback, relatórios/exportação.
10. **M09** bateria determinística e falhas injetadas, comparação com baseline, dois bots, guia operacional.

Cada milestone termina com os checks agregados da raiz (`build`, `typecheck`, `lint`, `test`) e commit local.

## Estratégia de testes por story

| Camada | Ferramenta | O que prova |
| --- | --- | --- |
| Unit | Vitest por pacote | Contratos, transições, políticas, redaction, idempotência, cálculo de uso, ops de workspace em diretório temporário |
| Integração simulada | Vitest + `Agent` real com `fetch` roteirizado | Loop real, ferramentas reais, eventos persistidos consultados no SQLite |
| E2E processo | Runner real por socket Unix, MCP stdio real, worker de bot real | Fronteiras de processo, restart, desconexão |
| E2E Docker | `OINKO_DOCKER_TEST=1` | Container de sandbox/browser, Git real, prévia, proxy |
| E2E UI | Playwright (dashboard build + start) | Configuração, trabalhos, controles, mobile, isolamento de rotas |
| Real | Provedor LLM, GitHub App, Telegram reais | **Pendente de operador**: exige credenciais e aceite humano; nunca inferido de testes simulados |

## Regras de status

- `completed` só quando todos os critérios automatizáveis passaram e nenhum critério depende de validação real; stories com critério real pendente ficam `in_progress` com a justificativa no registro de entrega.
- Skipped e não executado aparecem como tais. Custo indisponível nunca vira zero.
- Evidência = comando, revisão Git, resultado e limitações, registrados na própria story.
