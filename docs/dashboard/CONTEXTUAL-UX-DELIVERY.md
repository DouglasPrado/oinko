# Dashboard por projeto e por bot

Entrega verificada em 2026-09-23. Esta experiência substitui as telas independentes de ambientes, prévias e telemetria na navegação principal.

| Requisito | Resultado | Evidência |
| --- | --- | --- |
| Projeto como ponto de entrada | Criar projeto sem ambiente; adicionar/vincular ambientes no detalhe; abas de worktrees, repositórios e atividade | `project-hierarchy.spec.ts` e contratos de workspaces |
| Ambientes com prévias próprias | Rotas aninhadas, serviços expansíveis, tarefas/worktrees para subir, reconstruir, abrir e parar prévias | Navegador em 1440 e 390 px; fluxo Docker em desktop e móvel |
| Mais de um ambiente | Vínculos persistidos, seleção explícita, IDs/rotas/limites independentes; nomes de ambiente podem se repetir | `project-environments.test.ts`; Compose/Traefik reais em `docker.test.ts` |
| Telemetria dentro do bot | Bot → botão Telemetria → conversas e respostas do mesmo bot, com breadcrumbs e retorno ao bot | Dois bancos com IDs coincidentes, filtros, payloads/downloads e atualização ao vivo em `telemetry-bots.spec.ts` |
| Visual rico em informação | Cards de métricas, badges de estado/canais, progresso de respostas sem erro, tabela de conversas, tabs, breadcrumbs, menus, accordions, sheets, dialog, tooltips, alerts, skeletons e empty states | Componentes shadcn/Radix locais em `src/components/ui`; inspeção visual da dashboard e capturas dos testes |
| Fluxos preservados | Configurações avançadas, segredos, permissões, builders, Compose, terminal, logs, acesso de rede e controles dos bots | 23 testes de navegador aprovados, incluindo Docker real |
| Acessibilidade e móvel | Navegação por teclado, menu móvel, Escape e retorno do foco ao botão que abriu o painel; sem overflow horizontal da página | Testes de navegação e hierarquia; viewport de 390 px |

O teste Docker da dashboard cria um repositório local de monorepo, configura bot/projeto/ambiente, prepara worktrees, altera código pelo terminal do sandbox e abre a prévia via Traefik. Consulta logs com segredos ocultados e para as prévias. Executa o fluxo em desktop e viewport móvel. O cenário adicional de runtime verifica duas worktrees, duas configurações de ambiente, URLs independentes, preservação de volumes, recuperação e limite de concorrência. Testes de falha visual usam fixtures isoladas e não são apresentados como builds reais.

Dados anteriores permanecem válidos: `environmentId` continua sendo o padrão do sandbox e de clientes antigos; `environmentIds` vincula configurações adicionais. O ID da prévia é preservado mesmo quando o ambiente padrão muda. A ferramenta `workspace_preview` aceita ambiente para iniciar e ID da prévia para parar, mantendo a chamada antiga compatível. O runner valida autorização e vínculo antes de enfileirar.

Rotas antigas de ambientes e prévias levam a Projetos; atalhos antigos de bot continuam chegando à telemetria correta. A rota legada de telemetria continua disponível para bancos independentes do SDK, sem destino separado na sidebar. Cadastro e credenciais existentes não foram substituídos. Todos os projetos de verificação ficam em diretórios temporários próprios dos testes; não há projetos de demonstração no cadastro do usuário.

A validação móvel usa navegador com viewport reduzido, sem aceitação em aparelho físico. Não houve chamada paga a modelo nem envio de mensagens de teste ao Telegram. Nixpacks/CNB e demais limites de infraestrutura continuam conforme [ENVIRONMENTS-DELIVERY.md](./ENVIRONMENTS-DELIVERY.md).
