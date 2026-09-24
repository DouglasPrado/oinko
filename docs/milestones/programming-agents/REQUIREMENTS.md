# Requisitos e cobertura

**Status:** pending. IDs estáveis para rastrear pedido → milestone/story → teste → evidência.

[Voltar ao plano](README.md)

<a id="r01"></a>
## R01 — Capacidades reutilizáveis

Toda capacidade pertence ao Oinko e pode ser habilitada em qualquer bot. Dev é apenas o primeiro piloto. Compartilhar implementação entre dashboard, canais e MCP; não criar forks por bot. Provar uso com dois bots de configurações diferentes.

**Stories:** [M00-S01](M00/M00-S01.md), [M00-S02](M00/M00-S02.md), [M04-S01](M04/M04-S01.md), [M04-S03](M04/M04-S03.md), [M04-S04](M04/M04-S04.md), [M07-S04](M07/M07-S04.md), [M09-S03](M09/M09-S03.md).

<a id="r02"></a>
## R02 — Configuração e isolamento

Separar configuração por bot, projeto e execução; aplicar autorização na operação, nunca apenas na seleção de ferramenta. Isolar worktrees, contextos, sessões, credenciais, resultados e acesso à telemetria. Revogação tem efeito imediato nas operações seguintes.

**Stories:** [M00-S01](M00/M00-S01.md), [M00-S02](M00/M00-S02.md), [M01-S03](M01/M01-S03.md), [M02-S01](M02/M02-S01.md), [M04-S01](M04/M04-S01.md), [M04-S04](M04/M04-S04.md), [M05-S01](M05/M05-S01.md), [M05-S02](M05/M05-S02.md), [M06-S01](M06/M06-S01.md), [M09-S01](M09/M09-S01.md), [M09-S03](M09/M09-S03.md).

<a id="r03"></a>
## R03 — Contratos e armazenamento compatíveis

ProgrammingRun não substitui Task/worktree nem conversa. Persistir estado, passos, recibos, artefatos, revisões e relações em SQLite por migração aditiva, com ports e compatibilidade das APIs de conversa.

**Stories:** [M00-S01](M00/M00-S01.md), [M00-S04](M00/M00-S04.md), [M01-S02](M01/M01-S02.md), [M03-S01](M03/M03-S01.md), [M09-S04](M09/M09-S04.md).

<a id="r04"></a>
## R04 — Autonomia e durabilidade

Aceitar trabalho em background; um run ativo por bot e fila durável. Continuar ciclos sem limite global arbitrário de dez iterações. Retomar automaticamente após reconciliação. Bloquear após três tentativas consecutivas sem progresso verificado. Pausar/cancelar preservando trabalho; permitir orientação durante execução.

**Stories:** [M00-S02](M00/M00-S02.md), [M03-S02](M03/M03-S02.md), [M03-S03](M03/M03-S03.md), [M03-S04](M03/M03-S04.md), [M03-S05](M03/M03-S05.md), [M03-S06](M03/M03-S06.md), [M04-S01](M04/M04-S01.md).

<a id="r05"></a>
## R05 — Entrega autorizada até draft PR

Bot habilitado pode implementar, validar, commitar, fazer push na branch da tarefa e criar/atualizar draft PR. Merge, deploy e operações destrutivas requerem pedido explícito. Não há force push automático. Publicação autenticada fica isolada de código do projeto.

**Stories:** [M00-S02](M00/M00-S02.md), [M06-S01](M06/M06-S01.md), [M06-S02](M06/M06-S02.md), [M06-S03](M06/M06-S03.md).

<a id="r06"></a>
## R06 — Telemetria profunda de ponta a ponta

Capturar pedido, plano, decisões declaradas, políticas, contexto, LLM/Jev/resumos, ferramentas, MCP, buscas, arquivos, comandos, jobs, diffs, testes, preview, browser, Git, PR, CI, controles, retomadas e intervenção. Correlacionar bot/projeto/tarefa/run/passo/operação e instrumentar sucesso, erro e negativa.

**Stories:** [M01-S01](M01/M01-S01.md), [M01-S02](M01/M01-S02.md), [M01-S03](M01/M01-S03.md), [M01-S04](M01/M01-S04.md), [M01-S05](M01/M01-S05.md), [M04-S02](M04/M04-S02.md), [M06-S04](M06/M06-S04.md), [M08-S02](M08/M08-S02.md), [M08-S04](M08/M08-S04.md), [M09-S04](M09/M09-S04.md).

<a id="r07"></a>
## R07 — Privacidade e retenção

Redigir segredos antes de persistir; aplicar full/hashed/none ao payload sem perder envelope mínimo. Não prometer acesso ao raciocínio privado do modelo. Autorizar visualização/exportação e expirar artefatos conforme política, preservando recuperação de runs ativos.

**Stories:** [M01-S01](M01/M01-S01.md), [M01-S03](M01/M01-S03.md), [M01-S05](M01/M01-S05.md), [M08-S01](M08/M08-S01.md), [M08-S04](M08/M08-S04.md).

<a id="r08"></a>
## R08 — Recuperação e idempotência

Persistir intenção e resultado, deduplicar entregas, usar leases e revisar permissões. Resultado incerto não implica falha sem efeito. Reconciliar arquivos, jobs, commits, push e PR antes de repetir. Cancelamento não é rollback.

**Stories:** [M01-S02](M01/M01-S02.md), [M02-S03](M02/M02-S03.md), [M03-S01](M03/M03-S01.md), [M03-S02](M03/M03-S02.md), [M03-S03](M03/M03-S03.md), [M03-S04](M03/M03-S04.md), [M03-S05](M03/M03-S05.md), [M03-S06](M03/M03-S06.md), [M06-S02](M06/M06-S02.md), [M06-S03](M06/M06-S03.md), [M09-S01](M09/M09-S01.md).

<a id="r09"></a>
## R09 — Entendimento e edição precisa

Busca por caminho/conteúdo, filtros e paginação; leitura por intervalo/hash; substituição exata e patch com precondições. Validar todos os alvos antes de escrever, preservar mudanças anteriores, proteger raiz/symlinks. Resolver AGENTS por escopo, README e manifests pertinentes.

**Stories:** [M02-S01](M02/M02-S01.md), [M02-S02](M02/M02-S02.md), [M02-S03](M02/M02-S03.md), [M02-S04](M02/M02-S04.md), [M02-S05](M02/M02-S05.md), [M07-S02](M07/M07-S02.md), [M09-S01](M09/M09-S01.md).

<a id="r10"></a>
## R10 — Validação de código e monorepo

Descobrir comandos por projeto/pacote, permitir overrides e executar checks pertinentes. Associar evidência à revisão testada, distinguir falha de infraestrutura e invalidar aceite quando o código mudar. Preservar relação repo → pacote → worktree → preview.

**Stories:** [M02-S04](M02/M02-S04.md), [M02-S05](M02/M02-S05.md), [M03-S03](M03/M03-S03.md), [M05-S04](M05/M05-S04.md), [M09-S02](M09/M09-S02.md).

<a id="r11"></a>
## R11 — Operação em todas as interfaces

Dashboard configura e acompanha; Telegram/CLI reconhecem e controlam com status/pause/resume/cancel; MCP Oinko configura bots/projetos e controla runs. Mesmos serviços e permissões; não duplicar schemas equivalentes no contexto.

**Stories:** [M03-S02](M03/M03-S02.md), [M03-S05](M03/M03-S05.md), [M03-S06](M03/M03-S06.md), [M04-S01](M04/M04-S01.md), [M04-S02](M04/M04-S02.md), [M04-S03](M04/M04-S03.md), [M04-S04](M04/M04-S04.md), [M05-S03](M05/M05-S03.md), [M09-S03](M09/M09-S03.md).

<a id="r12"></a>
## R12 — Browser e prévias

Chromium/Playwright compatíveis e fixados em container gerenciado, não root com sandbox. Sessão por run, docs separadas de testes autenticados, credenciais de teste por projeto. Permitir preview autorizado e docs públicas, restringindo acesso privado inclusive redirects/subrequests. Capturar fluxo, screenshot, console/rede e revisão.

**Stories:** [M05-S01](M05/M05-S01.md), [M05-S02](M05/M05-S02.md), [M05-S03](M05/M05-S03.md), [M05-S04](M05/M05-S04.md), [M09-S01](M09/M09-S01.md), [M09-S02](M09/M09-S02.md).

<a id="r13"></a>
## R13 — GitHub App

App própria da instância, instalação e repositórios selecionados, chave cifrada e tokens curtos com menor escopo necessário. Sem PAT/credenciais pessoais do host. Criar/atualizar draft idempotente, reconciliar timeout, relacionar PRs multirepo e consultar CI por polling enquanto ativo.

**Stories:** [M06-S01](M06/M06-S01.md), [M06-S02](M06/M06-S02.md), [M06-S03](M06/M06-S03.md), [M06-S04](M06/M06-S04.md), [M09-S01](M09/M09-S01.md), [M09-S02](M09/M09-S02.md).

<a id="r14"></a>
## R14 — Contexto, ferramentas, fallback e consumo

Resumir em background com consistência por conversa, preparar histórico antigo, preservar histórico completo e recuperar trechos sob demanda. Jev escolhe capacidades a partir de catálogo compacto, schemas são carregados progressivamente. Fast troca para principal após 15 s sem saída útil ou indisponibilidade, uma troca automática por chamada, sem duplicação de texto/ações. Contar todos os tokens/custos disponíveis, sem teto financeiro.

**Stories:** [M00-S02](M00/M00-S02.md), [M01-S04](M01/M01-S04.md), [M02-S02](M02/M02-S02.md), [M02-S04](M02/M02-S04.md), [M04-S01](M04/M04-S01.md), [M07-S01](M07/M07-S01.md), [M07-S02](M07/M07-S02.md), [M07-S03](M07/M07-S03.md), [M07-S04](M07/M07-S04.md), [M09-S01](M09/M09-S01.md).

<a id="r15"></a>
## R15 — Qualidade e evidência mensurável

Fixar baseline e cenários antes da mudança. Comparar conclusão, falhas, intervenção, duração, tokens, chamadas e custo por tarefa concluída. Usar quatro casos reais repetidos três vezes, mais testes determinísticos/Docker/UI. Skipped não é aprovado; desconhecido não é zero; PR draft não é aceite humano.

**Stories:** [M00-S03](M00/M00-S03.md), [M01-S04](M01/M01-S04.md), [M01-S05](M01/M01-S05.md), [M02-S05](M02/M02-S05.md), [M03-S06](M03/M03-S06.md), [M04-S02](M04/M04-S02.md), [M05-S04](M05/M05-S04.md), [M06-S04](M06/M06-S04.md), [M07-S04](M07/M07-S04.md), [M08-S01](M08/M08-S01.md), [M08-S02](M08/M08-S02.md), [M09-S01](M09/M09-S01.md), [M09-S02](M09/M09-S02.md), [M09-S04](M09/M09-S04.md).

<a id="r16"></a>
## R16 — Melhoria controlada do desenvolvimento

Observar → identificar → propor → avaliar em bateria fixa → comparar → promover com aprovação → observar e reverter se necessário. Versionar prompts/modelos/ferramentas/políticas, proteger dataset e manter rollback. Não alterar produção automaticamente a partir de um diagnóstico.

**Stories:** [M00-S03](M00/M00-S03.md), [M08-S01](M08/M08-S01.md), [M08-S02](M08/M08-S02.md), [M08-S03](M08/M08-S03.md), [M08-S04](M08/M08-S04.md), [M09-S03](M09/M09-S03.md).

<a id="r17"></a>
## R17 — Adoção, compatibilidade e operação

Entregar em PRs incrementais, sem incorporar mudanças alheias. Validar fixtures/repo GitHub de teste, piloto Dev e segundo bot. Preservar conversação tradicional, ter backup/rollback/runbook, atualizar blueprints/mappings. Não implementar automerge, autodeploy, treinamento de modelo ou múltiplos agentes neste plano.

**Stories:** [M00-S04](M00/M00-S04.md), [M08-S03](M08/M08-S03.md), [M09-S03](M09/M09-S03.md), [M09-S04](M09/M09-S04.md).

## Regras de cobertura

Uma story pode atender vários requisitos. Cobertura documental não é cobertura executada. A evidência será armazenada na story e ligada aos IDs de run, revisão de código e relatório de testes. Toda story, mesmo sem R06 explícito, deve cumprir TELEMETRY.md e os gates transversais de VALIDATION.md.
