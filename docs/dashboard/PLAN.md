# Bots configuráveis na dashboard

**Escopo reaberto em 2026-09-22 por solicitação do usuário:** criar novos bots por configuração, administrá-los na dashboard e permitir acesso autenticado pela rede. Esta decisão substitui o adiamento anterior do configurador.

## Experiência

Em `/bots`, a pessoa cria um bot, define nome, modelo, instruções, credenciais e conexões. Pode editar, iniciar, parar e reiniciar. Salvar não interrompe uma conversa: a tela sinaliza a revisão pendente, aplicada no próximo reinício. CLI, Telegram, Higgsfield e MCP HTTP são reutilizados, sem copiar uma aplicação por bot.

A navegação principal é a mesma em Bots, Projetos, Ambientes, Prévias, Telemetria e Integrações. No desktop, fica em uma sidebar com a seção atual destacada, rolagem própria e saída no rodapé. No celular, o botão Menu revela os mesmos destinos e fecha ao navegar ou pressionar Escape. As conversas e respostas aparecem em uma seção separada dentro da sidebar da telemetria, inclusive no menu móvel.

## Responsabilidades

- `@oinko/core`: agente, modelos, ferramentas, memória, MCP e telemetria.
- `@oinko/agent-runtime`: serviço local, conversas, conexões e encerramento.
- `@oinko/bots`: cadastro persistido, credenciais cifradas, executor comum e controle dos processos.
- `apps/dashboard`: formulários, login e APIs autenticadas. Não executa o agente dentro de uma requisição HTTP.
- `apps/oink-lp`: compatibilidade com os comandos anteriores e importação da configuração existente.

Cada bot roda em um processo independente. A dashboard pode ser fechada ou reiniciada sem desligá-lo. O socket local impede duas instâncias no mesmo diretório de dados; uma operação de controle por vez e a verificação do token Telegram evitam partidas concorrentes conflitantes. Falhas de conexão aparecem na tela sem devolver credenciais.

## Dados e migração

O cadastro fica em `.harness/bots.db`, separado dos bancos do SDK. Segredos são cifrados com AES-256-GCM; a chave local fica em `.harness/bots.key`, com permissão 600. API e formulário retornam apenas indicadores de credenciais configuradas. Atualizações verificam a revisão para evitar sobrescrever uma edição concorrente.

Novos bots usam `.harness/bots/<id>/` para histórico, memória e telemetria. O Oink LP é importado uma única vez: mantém seus caminhos originais, token, instruções, modelo, transcrição e opções de telemetria. `.env`, `connections.json` e dados originais permanecem no disco. Depois da importação, a dashboard é a fonte das configurações. Um processo legado precisa ser encerrado uma vez antes de ser controlado pelo novo executor.

## Acesso

A senha inicial é definida em `/login`, com a dashboard ligada em localhost. O hash usa scrypt; sessões assinadas expiram em sete dias e usam cookie HttpOnly/SameSite. Todas as páginas de dados, APIs, SSE e OAuth exigem sessão. Mutações conferem a origem. O comando de acesso pela rede recusa iniciar antes da configuração inicial da senha.

Acesso remoto: `pnpm --filter @oinko/dashboard start:network` após o build e a configuração local. Em servidor acessível pela internet, colocar HTTPS na frente do Next. O cadastro é de um administrador; multiusuário e RBAC não fazem parte desta entrega.

## Validação

- Persistência e cifragem; ausência de segredos nas respostas; conflito de revisão.
- Dois bots executando pelo mesmo worker, isolamento de encerramento, reinício e revisão aplicada.
- Importação idempotente do Oink LP com caminhos e opções preservados.
- Senha, assinatura/expiração de sessão, rejeição de origem externa e acesso sem login.
- Navegador: criar, iniciar, editar, reiniciar, recarregar e parar um bot com provedor simulado.
- Suíte anterior da dashboard e checks agregados do workspace.

## Limites

A interface configura MCP HTTP com Bearer opcional e Higgsfield com OAuth compartilhado. MCP stdio e ferramentas/skills escritas em TypeScript continuam disponíveis na composição em código; não há editor de código nem execução de comandos arbitrários no formulário. A telemetria existente continua consultando `TELEMETRY_DB_PATH`; cada novo bot grava seu próprio banco, mas um seletor de bancos na tela de telemetria é uma evolução separada. Não há inicialização automática após reiniciar o computador nem exclusão de históricos pelo cadastro.
