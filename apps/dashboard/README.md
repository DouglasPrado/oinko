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

A tela existente lê o SQLite definido em `TELEMETRY_DB_PATH` no `.env.local`. Para o Oink LP:

```dotenv
TELEMETRY_DB_PATH=../../.harness/bots/oink-lp/telemetry.db
```

Todos os bots gravam `.harness/bots/<id>/telemetry.db`. O seletor de banco por bot na interface ainda não está implementado; ajuste `TELEMETRY_DB_PATH` e reinicie a dashboard para inspecionar outro banco. Custos continuam sendo os informados pelo provedor.

## Testes

```bash
pnpm --filter @oinko/dashboard test
pnpm --filter @oinko/dashboard test:e2e
```

Os testes de navegador criam cadastro, senha e telemetria em diretório temporário, usam o executor real com chave fictícia e não chamam provedores externos. O banco de telemetria é semeado com transporte simulado. Os dados do usuário não são usados nem apagados.

[Escopo e arquitetura](../../docs/dashboard/PLAN.md)
