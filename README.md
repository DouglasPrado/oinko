# Oinko

Monorepo de agentes, canais e integrações. O núcleo Oinko é independente das aplicações: cada agente define seu propósito e combina os pacotes de que precisa.

```text
apps/
  oink-lp/                 agente para landing pages
  dashboard/               painel de telemetria e autorização Higgsfield
packages/
  oinko/                   @oinko/core — modelos, ferramentas, memória e MCP genérico
  agent-runtime/           @oinko/agent-runtime — conversas, comandos e lifecycle
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

Configure `apps/oink-lp/.env` usando seu `.env.example`. O bot inicia todos os canais e MCPs habilitados em `apps/oink-lp/connections.json`. Use `pnpm --filter @oinko/oink-lp chat` para conectar a CLI ao processo existente e `reload` para aplicar mudanças nas conexões. Telegram exige token e IDs autorizados. [Configuração do Oink LP](apps/oink-lp/README.md).

## Dependências e responsabilidades

Aplicações dependem de pacotes. Canais dependem do runtime; integrações dependem do núcleo. O núcleo não conhece canais nem fornecedores de MCP específicos. Pacotes não importam código de `apps` ou `examples` e recebem configurações explicitamente.

O SDK antes publicado como `@gba/ai-harness` agora está em `packages/oinko`, com nome `@oinko/core`. Atualize os imports. A API `Agent` permanece a mesma. A raiz é privada e não publicável; somente o núcleo mantém a configuração de publicação. Os demais pacotes são privados do workspace.

[API e exemplos do núcleo](packages/oinko/README.md).

## Higgsfield compartilhado

A dashboard autoriza a conta e os agentes consomem a credencial em `.harness/credentials/higgsfield.json` na raiz. `HIGGSFIELD_CREDENTIAL_PATH` permite apontar cada consumidor para outra conta. Cada instância da integração tem sua própria sessão MCP e lista de ferramentas.

O pacote compartilha o formato de credencial, grava arquivos atomicamente com permissão 600 e serializa a renovação entre processos por arquivo. Se um processo morrer segurando o bloqueio, a próxima tentativa falha por timeout; após parar os consumidores, remova somente o diretório `<credencial>.lock` para liberar a renovação. Credenciais antigas dos exemplos não são versionadas nem apagadas.

O Oink LP conecta Higgsfield ao iniciar quando a credencial está disponível; `HIGGSFIELD=off` desativa. Depois da autorização inicial, execute `pnpm --filter @oinko/oink-lp reload` para carregar as ferramentas. As imagens recebidas podem ser preparadas como referência com `preparar_imagem_enviada`.

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
