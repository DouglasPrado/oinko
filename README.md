# Oinko

Monorepo de agentes, canais e integrações. O núcleo Oinko é independente das aplicações: cada agente define seu propósito e combina os pacotes de que precisa.

```text
apps/
  oink-lp/                 agente para landing pages
  dashboard/               bots, projetos, ambientes, prévias e telemetria
  environment-runner/      gerenciador local de Docker, builds e prévias
packages/
  oinko/                   @oinko/core — modelos, ferramentas, memória e MCP genérico
  agent-runtime/           @oinko/agent-runtime — conversas, comandos e lifecycle
  bots/                    @oinko/bots — cadastro e executor comum dos bots
  workspaces/              @oinko/workspaces — projetos, repositórios e worktrees
  environments/            @oinko/environments — sandbox, builders, Compose e Traefik
  channels/
    cli/                   @oinko/channel-cli
    telegram/              @oinko/channel-telegram — texto, imagens e áudio
  mcps/
    higgsfield/             @oinko/mcp-higgsfield — OAuth, credenciais, MCP e upload
examples/
  telegram-bot/            consumidor do workspace
  teams-bot/               exemplo de integração Teams
```

## Desenvolvimento

Node 22.13+ e pnpm 11 (versão fixada no `packageManager`).

```bash
pnpm install
pnpm build:packages
pnpm --filter @oinko/oink-lp dev
pnpm --filter @oinko/dashboard dev
```

Abra a dashboard em `http://127.0.0.1:3111/login`, defina a senha inicial e acesse **Bots**. Configure nome, modelo, instruções, credenciais, canais e MCPs, depois use **Iniciar**. Novos bots usam o mesmo executor, sem criar outra aplicação.

```bash
pnpm bot list
pnpm bot start meu-bot
pnpm bot chat meu-bot
pnpm bot restart meu-bot
pnpm bot stop meu-bot
```

O Oink LP existente é importado uma única vez, preservando configurações e caminhos de dados. Após a importação, as alterações são feitas na dashboard. A chave cifrada local e o cadastro ficam em `.harness`, fora do Git. [Executor e armazenamento](packages/bots/README.md).

Para acesso pela rede, configure primeiro a senha no computador e use `pnpm --filter @oinko/dashboard start:network` após o build. A dashboard exige login; os bots continuam rodando quando ela fecha.

Para programação, configure **Ambientes**, cadastre **Projetos** e autorize os bots. Cada tarefa cria worktrees próprias. Dockerfile, Railpack e imagens prontas podem ser combinados por serviço; Compose organiza a aplicação e Traefik fornece as prévias. O gerenciador também continua funcionando quando a dashboard fecha. [Guia de ambientes e acesso pelo celular](packages/environments/README.md).

## Dependências e responsabilidades

Aplicações dependem de pacotes. Canais dependem do runtime; integrações dependem do núcleo. O núcleo não conhece canais nem fornecedores de MCP específicos. Pacotes não importam código de `apps` ou `examples` e recebem configurações explicitamente.

O SDK antes publicado como `@gba/ai-harness` agora está em `packages/oinko`, com nome `@oinko/core`. Atualize os imports. A API `Agent` permanece a mesma. A raiz é privada e não publicável; somente o núcleo mantém a configuração de publicação. Os demais pacotes são privados do workspace.

[API e exemplos do núcleo](packages/oinko/README.md).

## Higgsfield compartilhado

A dashboard autoriza a conta e os agentes consomem a credencial em `.harness/credentials/higgsfield.json` na raiz. `HIGGSFIELD_CREDENTIAL_PATH` permite apontar cada consumidor para outra conta. Cada instância da integração tem sua própria sessão MCP e lista de ferramentas.

O pacote compartilha o formato de credencial, grava arquivos atomicamente com permissão 600 e serializa a renovação entre processos por arquivo. Se um processo morrer segurando o bloqueio, a próxima tentativa falha por timeout; após parar os consumidores, remova somente o diretório `<credencial>.lock` para liberar a renovação. Credenciais antigas dos exemplos não são versionadas nem apagadas.

O Oink LP conecta Higgsfield ao iniciar quando a conexão está habilitada e a credencial está disponível. Ative ou desative pela configuração do bot na dashboard (`HIGGSFIELD=off` é respeitado na importação inicial). Depois da autorização inicial, reinicie o bot pela dashboard para carregar as ferramentas. As imagens recebidas podem ser preparadas como referência com `preparar_imagem_enviada`.

## Verificação

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:coverage
pnpm validate:publish
```

Os scripts recursivos respeitam a ordem das dependências. `pnpm test:live` é separado: utiliza provedores reais e exige credenciais. Publicação e testes com serviços reais não são realizados automaticamente pela migração.
