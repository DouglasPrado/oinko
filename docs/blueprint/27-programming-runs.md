# Execuções de programação duráveis (ProgrammingRun)

Status: implementado e validado por testes automatizados e Docker; validações com provedor real, GitHub App real, Telegram real e aceite humano pendentes — ver [milestones programming-agents](../milestones/programming-agents/README.md) e o [guia de operação](../milestones/programming-agents/RUNBOOK.md). Complementa [24](24-workspaces-environments.md) (projetos, tarefas, sandbox), [25](25-oinko-mcp.md) (MCP) e [26](26-adaptive-context.md) (contexto).

## Resultado

Qualquer bot com a capacidade `programming` habilitada e autorizado em um projeto aceita trabalho de programação em segundo plano: entende o projeto, edita com precondições, valida, verifica a prévia e entrega um draft PR, deixando evidência verificável de cada passo. Dev é apenas o primeiro piloto; nenhuma regra depende do nome, canal ou ID do bot.

## Modelo

- **ProgrammingRun**: uma execução persistida de um pedido. Referencia bot, conversa de origem, projeto, Task existente e repositórios. Guarda pedido original, revisões do plano, snapshot de política, fase, passo atual, lease e resultado final. Não substitui Task (trabalho/worktree) nem Thread (conversa); uma Task pode receber vários runs ao longo do tempo.
- **RunStep**: unidade de progresso (ciclo, busca, edição, check, prévia, verificação funcional, publicação) com objetivo, tentativas e referências de entrada/saída/evidência.
- **OperationReceipt**: intenção e resultado de um efeito (`intended`, `running`, `succeeded`, `failed`, `uncertain`), chave idempotente vinculada a ator + operação + hash dos parâmetros, e efeitos observados.
- **Artifact**: evidência endereçada por conteúdo (diff, log, screenshot, relatório), com revisão testada (commit ou hash da árvore), política de captura, escopo de acesso e expiração.
- **Publication**: identidade bot/projeto/tarefa/repositório de um draft PR reaproveitável, run originador e runs contribuintes, SHA remoto e estado de reconciliação.
- **Evaluation**: caso versionado executado contra baseline e candidato, com rubrica, métricas e veredito.

## Estados

`queued → running | cancelled | blocked`; `running → paused | blocked | completed | failed | cancelled`; `paused → queued | cancelled | blocked`; `blocked → queued | cancelled | failed`. `completed`, `failed` e `cancelled` são terminais e imutáveis; nova tentativa cria outro run ligado ao anterior. `pause_requested`/`cancel_requested` são intenções persistidas, não transições concluídas. Run com operação `uncertain` não vira `completed`.

## Invariantes

1. Um run de programação ativo por bot; fila durável; via de controle independente da fila e do LLM.
2. Autorização acontece na operação, com a política e o acesso **atuais**; revogação vale na próxima operação. Seleção de ferramenta (Jev) é sugestão, não autorização.
3. Intenção persistida antes de efeito mutável; falha ao persistir impede a mutação e bloqueia o run.
4. Ciclos limitados de raciocínio continuam automaticamente; o limite de iterações do loop SDK é por ciclo, não por run. Três ciclos consecutivos sem progresso verificável bloqueiam o run. Gasto nunca participa desse limite: não há teto financeiro.
5. Declaração textual do modelo não conclui o run; conclusão exige critérios avaliados contra evidências da revisão atual. Nova edição invalida checks anteriores.
6. Cancelamento encerra processos controlados e preserva arquivos, commits e prévias; nunca executa reset/clean/remoção implícita.
7. Merge, deploy e operações destrutivas exigem autorização explícita específica e não são automatizados. Não há force push.
8. Pedido apenas de análise nunca modifica o projeto.

## Portas

`ProgrammingStore` (persistência em `programming.db`), `AccessPort` (autorização atual bot → projeto; `StoreAccess` nos bots), `RunnerPort` (operações na worktree, prévia, navegador e publicação via runner; `EnvironmentClient` em produção, `LocalRunner` só no ambiente simulado), `RunExecutor` (um ciclo pelo agente; `AgentCycleExecutor`), `Reconciler` (efeitos incertos; `RunnerReconciler`), `BotConfigPort` (promoção/rollback de candidatos com CAS), `TelemetryJournal` + entrega ao `telemetry.db` do bot. Dashboard, canais, MCP e ferramentas do bot usam o mesmo `ProgrammingRunService`.

## Implementação

| Área | Onde |
| --- | --- |
| Contratos, estados, políticas | `packages/agent-runtime/src/programming/{contracts,state,policy,policy-schema}.ts` |
| Persistência, migrations, backup | `packages/agent-runtime/src/programming/store/` (v1 runs; v2 avaliação) |
| Journal, envelope, catálogo, redaction, entrega | `packages/agent-runtime/src/programming/telemetry/` |
| Serviço (fila, ciclos, safe points, recuperação, critérios) | `packages/agent-runtime/src/programming/{service,evidence,operations}.ts` |
| Executor de ciclo e ferramentas de controle | `packages/agent-runtime/src/programming/agent-executor.ts` |
| Ferramentas do agente (workspace, prévia, navegador, funcional, publicação, CI) | `packages/bots/src/programming/{run-tools,delivery-tools}.ts` |
| Runner (workspace ops, navegador isolado, GitHub App) | `packages/environments/src/{workspace,browser,publication}/` |
| Canais, notificações, relatório de entrega | `packages/agent-runtime/src/programming/{channel,notifier,delivery-report}.ts` |
| Avaliação e melhoria | `packages/agent-runtime/src/programming/evaluation/`, `packages/bots/src/programming/evaluation/`, `packages/bots/evaluation/*.json` |
| Validação e aceite | `packages/agent-runtime/src/programming/validation.ts`, `scripts/validation-suite.mjs` |

## Telemetria

Envelope e catálogo em [TELEMETRY.md](../milestones/programming-agents/TELEMETRY.md). Correlação bot/projeto/tarefa/run/passo/operação é explícita e propagada para chamadas LLM via `ChatOptions.correlation` do SDK.
