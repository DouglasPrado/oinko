# Workspaces

Cadastro de projetos, repositórios e tarefas, persistido em SQLite com revisão para detectar alterações concorrentes. Um projeto contém um monorepo ou um conjunto de repositórios relacionados. Uma tarefa contém uma branch/worktree em cada repositório.

`WorkspaceStore.authorize` verifica a permissão do bot. `WorktreeManager` trabalha através de `WorkspaceExecutor`: comandos Git passam pelo executor do sandbox, sem dependência do SDK de IA neste pacote. O checkout original nunca é usado como diretório de trabalho do agente.

`@oinko/workspaces/contracts` pode ser usado por formulários sem carregar SQLite. A composição e o fluxo operacional estão documentados em [environments](../environments/README.md).
