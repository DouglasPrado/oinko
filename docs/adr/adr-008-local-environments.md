# ADR 008: ambientes locais administrados fora dos agentes

Decisão: separar projetos/worktrees e ambientes em pacotes, com um serviço local que controla Docker, builds e prévias. O agente solicita operações por uma API restrita; a dashboard é um cliente autenticado. O processo de programação roda em container sem socket Docker.

Um projeto pode conter um monorepo ou repositórios relacionados. Configurações de ambiente são reutilizáveis; dados e recursos de execução pertencem ao projeto e à tarefa. Compose recebe imagens de builders intercambiáveis; Traefik oferece as rotas. O builder não determina as permissões do sandbox.

O runner mantém estado em SQLite e reconcilia containers pelos identificadores próprios. Dados e segredos não ficam nos diretórios versionados dos projetos. Recursos externos ao workspace não podem ser concedidos por um Compose encontrado no repositório.

Fonte de requisitos: [blueprint 24](../blueprint/24-workspaces-environments.md). Dockerfile, Railpack e imagem pronta são o escopo inicial autorizado; outros builders permanecem extensões futuras.
