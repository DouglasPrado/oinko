# Dashboard Oinko

Configuração e controle de bots, autorização Higgsfield e inspeção de telemetria.

## Iniciar

```bash
pnpm --filter @oinko/dashboard dev
```

Abra `http://127.0.0.1:3111/login`. No primeiro acesso local, crie uma senha de pelo menos 12 caracteres. Entre em **Bots** para criar e editar agentes, habilitar CLI/Telegram/MCPs e iniciar, parar ou reiniciar cada processo. As credenciais não são devolvidas ao navegador depois de salvas.

Todos os bots usam o executor `@oinko/bots`, sem criar outra pasta de aplicação. Salvar uma edição não interrompe o bot: a tela indica que é preciso reiniciar para aplicar a revisão.

## Rede e servidor

Depois de configurar a senha localmente:

```bash
pnpm --filter @oinko/dashboard build
pnpm --filter @oinko/dashboard start:network
```

Esse comando escuta na rede, na porta 3111 (`PORT` pode alterar). O comando recusa iniciar antes da senha inicial existir. Em servidor público, configure HTTPS no proxy reverso. Páginas, APIs de dados, SSE e autorização Higgsfield exigem login. Esta versão tem um administrador; não inclui multiusuário/RBAC.

O arquivo `.harness/dashboard-auth.json` contém hash scrypt e chave de sessão, com permissão 600. Preserve-o no backup junto com `.harness/bots.db`, `.harness/bots.key` e os dados dos bots. `OINKO_ROOT` permite escolher outro diretório de estado. A dashboard pode reiniciar sem encerrar os bots.

## Telemetria

Use **Ver telemetria** no cartão do bot ou **Telemetria do bot** no topo da tela para alternar entre bots cadastrados. Cada um grava `.harness/bots/<id>/telemetry.db`; a dashboard descobre o caminho pelo cadastro e não exige reinício ao criar um bot.

A seleção fica na URL (`/?bot=dev`) e acompanha as conversas, respostas, conteúdos completos, downloads e atualizações ao vivo. Antes do primeiro turno, a tela informa que ainda não há conversas; com telemetria desativada, orienta ativá-la e reiniciar o bot. Os bancos permanecem separados e são lidos sem modificações. Custos são os informados pelo provedor.

`TELEMETRY_DB_PATH` no `.env.local` é opcional para bots cadastrados. Ele continua atendendo consumidores independentes do SDK e define a seleção inicial quando aponta para o banco de um bot:

```dotenv
TELEMETRY_DB_PATH=../../.harness/bots/oink-lp/telemetry.db
```

## Testes

```bash
pnpm --filter @oinko/dashboard test
pnpm --filter @oinko/dashboard test:e2e
```

Os testes de navegador criam cadastro, senha e telemetria em diretório temporário, usam o executor real com chave fictícia e não chamam provedores externos. O banco de telemetria é semeado com transporte simulado. Os dados do usuário não são usados nem apagados.

[Escopo e arquitetura](../../docs/dashboard/PLAN.md)
