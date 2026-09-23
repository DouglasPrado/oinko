# Bots configuráveis na dashboard

**Escopo reaberto em 2026-09-22 por solicitação do usuário:** criar novos bots por configuração, administrá-los na dashboard e permitir acesso autenticado pela rede. Esta decisão substitui o adiamento anterior do configurador.

## Experiência

Em `/bots`, a pessoa cria um bot, define nome, modelo, instruções, credenciais e conexões. Pode editar, iniciar, parar e reiniciar. Salvar não interrompe uma conversa: a tela sinaliza a revisão pendente, aplicada no próximo reinício. CLI, Telegram, Higgsfield e MCP HTTP são reutilizados, sem copiar uma aplicação por bot.

A navegação principal contém Bots, Projetos e Integrações. Projetos contêm ambientes, e cada ambiente apresenta suas prévias. Worktrees e atividade pertencem ao projeto. A telemetria é aberta pelo botão no bot, em `/bots/[botId]/telemetria`, mantendo o contexto nas conversas e respostas. No desktop, fica em uma sidebar com a seção atual destacada, rolagem própria e saída no rodapé. No celular, o botão Menu revela os mesmos destinos e fecha ao navegar ou pressionar Escape. As conversas e respostas aparecem em uma seção separada dentro da sidebar da telemetria, inclusive no menu móvel.

A lista de bots separa **Canais** (CLI e Telegram) de **MCPs** (Higgsfield, Oinko e demais integrações). Cada grupo preserva o estado das conexões e a identificação acessível; bots parados mostram as conexões configuradas nos mesmos grupos. No desktop, os grupos usam colunas distintas; em telas menores, rótulos acompanham os ícones.

## Responsabilidades

- `@oinko/core`: agente, modelos, ferramentas, memória, MCP e telemetria.
- `@oinko/agent-runtime`: serviço local, conversas, conexões e encerramento.
- `@oinko/bots`: cadastro persistido, credenciais cifradas, executor comum e controle dos processos.
- `apps/dashboard`: formulários, login e APIs autenticadas. Não executa o agente dentro de uma requisição HTTP.

Cada bot roda em um processo independente. A dashboard pode ser fechada ou reiniciada sem desligá-lo. O socket local impede duas instâncias no mesmo diretório de dados; uma operação de controle por vez e a verificação do token Telegram evitam partidas concorrentes conflitantes. Falhas de conexão aparecem na tela sem devolver credenciais.

O socket dos bots usa `/tmp` em Unix, com usuário e diretório de dados na identidade, independentemente de `TMPDIR`. Assim um cliente MCP e a dashboard encontram o mesmo processo. Ao atualizar de uma versão anterior, encerre os bots antes de trocar o executor e reinicie os clientes.

### Decisor e roteamento

`intelligence` é uma configuração opcional por bot: `enabled` conecta o Jev da TypeSafe, `fastModel` define o modelo para turnos simples e `minConfidence` define o limiar (padrão 0,85). Ausente ou desabilitada, mantém o comportamento anterior. Sem `fastModel`, o Jev participa das outras decisões, mas não troca o modelo. Com roteamento, ambos os modelos usam o mesmo provedor LLM do bot; para OpenRouter, use os IDs completos do catálogo. O modelo principal permanece como fallback quando o decisor falha ou não tem confiança suficiente.

A credencial `typesafeKey` é independente da chave do OpenRouter, cifrada no cadastro e exposta apenas pelo indicador `hasTypesafeKey`. Um bot com Jev habilitado sem essa credencial recusa iniciar com erro explícito. O runner monta `JevDecider` do SDK com timeout de 15 segundos; o SDK registra suas decisões e falhas na telemetria da execução. A configuração e a chave podem ser atualizadas pelo MCP administrativo; a dashboard preserva essa configuração ao editar outros campos. Não há ativação implícita por variável de ambiente.

## Dados e migração

O cadastro fica em `.harness/bots.db`, separado dos bancos do SDK. Segredos são cifrados com AES-256-GCM; a chave local fica em `.harness/bots.key`, com permissão 600. API e formulário retornam apenas indicadores de credenciais configuradas. Atualizações verificam a revisão para evitar sobrescrever uma edição concorrente.

Todos os bots usam `.harness/bots/<id>/` para histórico, memória e telemetria. O Oink LP é uma configuração comum do cadastro, administrada pela dashboard. A migração final move seus dados para esse diretório e atualiza o caminho da telemetria, preservando ID, revisão, credenciais, instruções, modelo, transcrição e conexões. A aplicação específica e o importador automático foram removidos.

Na instalação existente, a transferência é feita com bot e dashboard parados, backup privado do cadastro e chave juntos, configurações locais e dados. A cópia é conferida por hashes, integridade SQLite e conteúdo do cadastro antes de reiniciar o executor compartilhado. O backup fica fora do Git em `.harness/backups/`.

## Acesso

A senha inicial é definida em `/login`, com a dashboard ligada em localhost. O hash usa scrypt; sessões assinadas expiram em sete dias e usam cookie HttpOnly/SameSite. Todas as páginas de dados, APIs, SSE e OAuth exigem sessão. Mutações conferem a origem. O comando de acesso pela rede recusa iniciar antes da configuração inicial da senha.

Acesso remoto: `pnpm --filter @oinko/dashboard start:network` após o build e a configuração local. Em servidor acessível pela internet, colocar HTTPS na frente do Next. O cadastro é de um administrador; multiusuário e RBAC não fazem parte desta entrega.

## Validação

- Persistência e cifragem; ausência de segredos nas respostas; conflito de revisão.
- Dois bots executando pelo mesmo worker, isolamento de encerramento, reinício e revisão aplicada.
- Caminhos canônicos preservados após edição e reabertura do cadastro; comando de importação aposentado.
- Runtime e canais: histórico persistente, isolamento de conversas, encerramento e suporte Telegram a texto, imagem e áudio, testados nos respectivos pacotes.
- Senha, assinatura/expiração de sessão, rejeição de origem externa e acesso sem login.
- Navegador: criar, iniciar, editar, reiniciar, recarregar e parar um bot com provedor simulado.
- Telemetria de dois bots com IDs coincidentes, troca de banco, conteúdo completo/download, atualização ao vivo e bot ainda sem dados.
- Suíte anterior da dashboard e checks agregados do workspace.

## Limites

O cadastro também aceita MCP local (`transport: "stdio"`, `command`, `args`), configurado pelo administrador via `BotStore`. O executor reutiliza o transporte do núcleo, inicia o subprocesso sem shell e encerra a conexão junto com o bot. A dashboard exibe essa conexão, permite habilitar/remover e preserva seus campos ao editar o bot, sem exigir URL ou token HTTP. O comando e os argumentos são configuração pública do cadastro: não devem conter segredos. O ambiente herdado segue o transporte stdio do SDK; variáveis customizadas não fazem parte deste contrato.

A interface cadastra MCP HTTP com Bearer opcional e Higgsfield com OAuth compartilhado. Ferramentas/skills escritas em TypeScript continuam disponíveis na composição em código; não há editor de código nem execução de comandos arbitrários no formulário. A telemetria é acessada dentro de qualquer bot cadastrado. O ID do bot fica no caminho da página e acompanha conversas, respostas e detalhes; downloads e atualizações ao vivo carregam esse mesmo ID na API. Links antigos com `bot=<id>` continuam compatíveis. Cada banco é aberto separadamente, somente para leitura. Bots sem execuções mostram um estado vazio. `TELEMETRY_DB_PATH` continua disponível para consumidores independentes do SDK e define a seleção inicial quando corresponde a um bot. Não há inicialização automática após reiniciar o computador nem exclusão de históricos pelo cadastro.

## Componentes da experiência

A interface usa componentes shadcn/Radix locais: cards e badges para resumo/estado, breadcrumbs para contexto, tabs para vistas do mesmo recurso, sheets para configurações/terminal/logs, dialog para criar tarefa, menus para ações do sandbox, accordion para detalhes dos serviços e reutilização de configuração, alert para falhas, skeleton para carregamento, empty para primeiros passos, table e progress para telemetria, tooltip para retenção. Campos avançados e credenciais permanecem disponíveis. Sheets restauram o foco ao fechar.
