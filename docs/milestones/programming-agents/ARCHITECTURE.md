# Arquitetura e contratos propostos

**Status:** proposta de implementação, pending. [Voltar ao plano](README.md).

## Fronteiras de responsabilidade

| Área | Responsabilidade | Não deve incorporar |
| --- | --- | --- |
| `packages/oinko` | Contexto, chamadas LLM, seleção de ferramentas, eventos, uso e contratos de stores | Docker, identidade de bot piloto, UI ou credenciais GitHub |
| `packages/agent-runtime` | ProgrammingRun durável, fila, passos, controle e recuperação | Lógica específica de Telegram ou implementação de browser |
| `packages/bots` | Composição/configuração de capacidades e adapters de ferramentas | Implementações de sandbox duplicadas por bot |
| `packages/workspaces` | Projeto, repositório, Task/worktree e autorização de acesso | Conversa como substituto da tarefa Git |
| `packages/environments` e `apps/environment-runner` | Operações isoladas, jobs, arquivos, testes, previews e browser | Credenciais pessoais do host ou privilégio administrativo implícito |
| Serviço de publicação GitHub | Token restrito, revisão de conteúdo, Git autenticado, PR e CI | Executar código do repositório com token disponível |
| Dashboard, canais, MCP Oinko | Interfaces para os mesmos serviços e permissões | Regras de negócio divergentes ou IDs fixos de bot |

Não criar um pacote novo apenas para mudar nomes. Em M00, escolher a localização do serviço de publicação conforme as dependências; manter uma porta própria e um executor isolado mesmo que a implementação permaneça em um pacote existente. Novas dependências precisam respeitar a política do monorepo; browser fica fora do núcleo SDK.

## Modelo persistido

| Entidade | Campos mínimos propostos |
| --- | --- |
| ProgrammingRun | id, botId, conversationId, projectId, taskId, repositoryIds, request, state, phase, planRevision, policySnapshot, createdAt, updatedAt, revision, currentStepId, lease, finalOutcome |
| RunStep | id, runId, kind, status, attempt, objective, inputRefs, outputRefs, evidenceRefs, startedAt, finishedAt |
| OperationReceipt | operationId, runId, stepId, idempotencyKey, executorId/jobId, intent, preconditions, state, resultRef, error, observedEffects, timestamps |
| Artifact | id, runId, stepId, type, repositoryId, commitSha ou treeHash, location, contentHash, size, capturePolicy, accessScope, expiresAt |
| Publication | projectId, taskId, repositoryId, branch, originatingRunId, contributingRunIds, remoteSha, prId/url, draft, checkRefs, reconciliationState |
| Evaluation | datasetVersion, candidateVersion, baselineVersion, caseId, repetition, runId, rubric, metrics, verdict, evidenceRefs |

Persistir versões de schemas e snapshots de modelo, prompt, ferramentas, código, ambiente e política. Não armazenar segredos no snapshot; somente referências versionadas. Acrescentar entidades/tabelas por stores, nunca SQL espalhado nos adaptadores de interface.

Task segue sendo a unidade de trabalho/worktree já existente; um mesmo trabalho pode receber mais de um run ao longo do tempo. Projeto pode conter vários repositórios; monorepo contém pacotes sob o mesmo repositório. A sandbox pertence ao projeto; cada tarefa escolhe suas worktrees e cada prévia identifica os serviços e a revisão testada.

## Estados e controle

| Origem | Destino permitido | Condição |
| --- | --- | --- |
| queued | running, cancelled, blocked | Lease adquirido e acesso válido; ou controle/restrição antes de executar |
| running | paused, blocked, completed, failed, cancelled | Ponto seguro, impedimento, critérios satisfeitos, falha terminal conhecida ou cancelamento confirmado |
| paused | queued, cancelled, blocked | Retomada solicitada/permitida e permissão atual conferida |
| blocked | queued, cancelled, failed | Bloqueio resolvido com evidência; ou encerramento explícito |
| completed, failed, cancelled | nenhum | Estado terminal imutável; nova tentativa cria novo run ligado ao anterior |

`pause_requested` e `cancel_requested` são intenções de controle persistidas, não equivalem à conclusão da transição. `recovering` pode ser uma fase do run, não precisa ser um novo estado público. Durante recuperação, o lease e a reconciliação precedem qualquer operação mutável.

Operações têm estados `intended`, `running`, `succeeded`, `failed`, `uncertain`. Um run com efeito externo incerto não vira `completed`; cancelamento pode cessar o processamento local, mas o resultado incerto segue explícito e sua reconciliação continua como trabalho de auditoria, sem repetir efeitos nem retomar o objetivo cancelado. `failed` só descreve falha conhecida, não prova de ausência de efeito remoto.

Pausa preserva fila/contexto e espera ponto seguro; cancelamento encerra processos controlados e preserva arquivos/commits. Não existe reset, remoção de worktree ou exclusão de preview como consequência implícita do cancelamento.

## Concorrência e recuperação

- Um run de programação ativo por bot. Jobs internos podem durar além de uma chamada LLM; isso não autoriza dois runs escritores no mesmo bot.
- Fila persistida; via de controle independente. Conflito de escrita entre bots no mesmo trabalho é serializado por worktree, com lease e precondições de conteúdo.
- Checkpoints no fim de cada passo/ciclo e recibos antes/depois de efeitos. Estado usa revisão esperada para rejeitar sobrescrita concorrente.
- Restart consulta jobs, hashes, Git local/remoto e PR. Só repete operação quando for seguro ou comprovadamente não tiver ocorrido.
- Ausência de recibo final significa incerteza. Se não houver meio confiável de reconciliar, bloquear e pedir a informação necessária.
- Até três tentativas consecutivas sem progresso verificável; depois `blocked`. Erros repetidos não são progresso. Gasto não participa desse limite.

## Interfaces propostas

Os nomes finais de métodos/endpoints serão fixados em M00. O contrato comportamental é obrigatório:

| Serviço | Operações | Resultado |
| --- | --- | --- |
| Runs | start, list, get, pause, resume, cancel, steer | Aceite durável com runId; paginação; revisão esperada e status do pedido de controle |
| Workspace | searchPaths, searchContent, readRange, replaceExact, applyPatch, diff | Paths relativos, hashes/precondições, limites e referências de resultados |
| Jobs/checks | start, inspect, attach, stop, validate | jobId estável, status, revisão testada, log limitado e referência completa |
| Browser | session, navigate, read, click, fill, wait, screenshot, diagnostics | Sessão autorizada por run, resultado estruturado e artefatos |
| Publication | review, commit, push, ensureDraft, inspectChecks, reconcile | SHA/repo/branch, PR e recibos idempotentes |
| Telemetry/evaluation | query, artifact, compare, candidate, promote, rollback | Resultados autorizados e paginados, versões e evidências |

Toda operação recebe identidade autenticada e escopo, valida capacidades e permissões no servidor e retorna erro estruturado (`code`, `retryable`, `operationId`, `traceId`, detalhes redigidos). O cliente não pode escolher um `botId` e ganhar sua autoridade. Chaves idempotentes são vinculadas ao ator, operação e hash dos parâmetros; mesma chave com parâmetros diferentes produz conflito.

Dashboard, MCP e ferramentas do bot usam as mesmas portas. `workspace_*` e `oinko_*` equivalentes não são expostos simultaneamente ao modelo sem necessidade. Descoberta/seleção de ferramenta não substitui autorização. Preservar interface tradicional de conversa; novo run não deve depender do lifetime de uma conexão HTTP.

## Política e credenciais

| Escopo | Configuração |
| --- | --- |
| Bot | Capacidades, modelos, contexto, seleção, autonomia, retomada e canais/MCPs |
| Projeto | Repositórios, autorização de bots, ambiente, pacotes/comandos, browser e credenciais de teste/GitHub App |
| Run | Snapshot resolvido, plano, objetivo, passos, revisão de código e referências de evidências |

Default de programação habilitada: retomada automática, um run ativo por bot, entrega até draft PR quando publicação for autorizada. Não ampliar permissões de bots existentes ao migrar. Políticas novas valem para novos runs; mudanças urgentes de acesso/revogação são verificadas imediatamente. Aplicar mudança de configuração a run ativo exige revisão explícita e registro.

A instrução do usuário **sem teto financeiro** prevalece sobre referências genéricas antigas a CostPolicy. Manter medidas e, se configurados, avisos; não adicionar limite monetário, cancelamento por custo ou teto por sessão. Timeout de comando, tamanho de resposta e limite de ciclo são controles técnicos, documentados separadamente.

GitHub App usa chave cifrada, tokens curtos/restritos e executor separado. Não executar hooks, helpers de credencial definidos pelo repo, filtros ou comandos de build dentro do processo autenticado. Browser usa sessões de teste por projeto e nenhum perfil pessoal. Merge/deploy/destruição só por autorização explícita específica; este backlog não implementa automação desses fluxos.

## Compatibilidade e entrega

Migração aditiva, com cópia de segurança e validação de restauração antes de rollout. Não sobrescrever configurações existentes. Configuração/execução/telemetria usam schemas versionados. Desativar capacidade impede novos runs; drenar ou pausar os ativos sem apagá-los. Rollback de código depende da compatibilidade do schema e deve preservar auditoria.

As alterações atuais do redesign da dashboard são trabalho separado. Implementar PRs pequenos por capacidade, revisar base Git antes de começar e atualizar os blueprints pertinentes junto do código. A documentação deste plano não faz commit, push, merge nem altera configuração de bots.
