# Ambientes de programação e prévias

O Oinko administra ambientes locais com Docker. O bot trabalha nos clones e worktrees de um projeto; os serviços da aplicação executam em containers próprios. A dashboard e as ferramentas dos bots chamam o mesmo gerenciador, que continua executando quando a dashboard fecha.

## Uso pela dashboard

1. Instale Node 22.13+, pnpm e Docker com Compose e Buildx. Mantenha o Docker em execução.
2. Na raiz do Oinko, execute `pnpm install` e `pnpm build`. Inicie com `pnpm --filter @oinko/dashboard start`.
3. Em **Ambientes**, cadastre a imagem de programação, os limites e os serviços. A imagem padrão inclui Node, Python, Git, Bash, curl e Corepack. Uma imagem própria precisa oferecer Git, Bash, Node, `timeout` e `sleep`.
4. Em **Projetos**, escolha o ambiente e informe uma origem Git HTTPS sem credenciais ou o caminho absoluto de um repositório local. O checkout original não é modificado. Configure os bots autorizados.
5. Em **Bots**, habilite **Trabalhar com código em ambientes Docker** e reinicie o bot para carregar essa revisão.
6. Crie uma tarefa. O gerenciador prepara uma branch e uma worktree em cada repositório. O terminal e as ferramentas do bot trabalham nessas worktrees.
7. Use **Subir prévia**, acompanhe a operação e abra o serviço quando estiver pronto. **Parar prévia** conserva volumes e arquivos.

Um ambiente é uma definição reutilizável. Cada projeto tem seu container de programação e seus dados separados. Um monorepo é um único repositório; mantenha `.` como contexto de build quando o serviço usa pacotes compartilhados. Repositórios relacionados podem pertencer ao mesmo projeto.

## Builders e serviços

Cada serviço escolhe um método:

| Método        | Uso                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Imagem pronta | Banco, Redis ou uma aplicação já empacotada; a imagem é obtida se ainda não existir localmente. |
| Dockerfile    | Contexto e Dockerfile relativos à worktree, com argumentos públicos de build.                   |
| Railpack      | Detecção automática da aplicação; comandos de build e início podem ser definidos.               |

Railpack está fixado em **0.39.0**. O primeiro uso baixa a distribuição oficial para macOS/Linux x64/arm64 e verifica o SHA-256 publicado no release. `OINKO_RAILPACK_BIN` permite usar uma instalação própria. A preparação do plano é feita pelo gerenciador; os passos de build são executados pelo BuildKit. A integração segue a [referência oficial de frontend](https://railpack.com/platforms/buildkit-frontend). Há um contrato de builder para futuras integrações; Nixpacks e Cloud Native Buildpacks ainda não possuem adaptadores.

Em **Prévia compilada**, mudanças exigem reconstrução. Em **Desenvolvimento com código montado**, a worktree é montada em `/app`; escolha a pasta de execução e um comando que inicie seu servidor em `0.0.0.0`. Hot reload depende do servidor escolhido. Use uma imagem com as dependências de desenvolvimento; a imagem final de um builder pode conter apenas o necessário para produção.

As variáveis de build são públicas e podem acabar na imagem. Segredos de execução ficam nos campos próprios e são selecionados por serviço. Os valores não voltam à interface: campos vazios preservam o valor salvo; **Remover** exclui a credencial. Logs e erros conhecidos são mascarados, incluindo os valores da execução anterior após uma rotação.

## Compose do repositório

Informe o ID do repositório e um caminho relativo, como `compose.yaml`. A receita fornece imagens, build/contexto/Dockerfile/target/args, comandos, healthchecks, dependências e volumes. Na dashboard, serviços com o mesmo ID configuram exposição HTTP, porta, verificação de disponibilidade, variáveis, segredos e modo de desenvolvimento.

- Imagens e argumentos de build podem usar `${VAR}` e valores padrão como `${VAR:-22}`, resolvidos pelas variáveis públicas configuradas no serviço.
- Variáveis de execução do Compose e arquivos `env_file` simples usam os valores configurados e os segredos selecionados para aquele serviço. O ambiente do processo host não é herdado. Arquivos `env_file` aceitam `KEY=VALUE`, comentários e aspas simples/duplas; não executam shell.
- Em comandos e healthchecks, `$VAR`/`$$VAR` chegam ao container para expansão pelo shell da aplicação. Valores do host não são substituídos nesses campos.
- Bind mounts usam caminhos relativos existentes dentro do diretório da receita; volumes nomeados precisam estar declarados e são privados da prévia. A sintaxe aceita é `origem:/destino[:ro]`.
- Portas publicadas, labels e redes da receita são substituídas pela configuração administrada pelo Oinko. Só serviços marcados na dashboard recebem uma rota.
- Includes, extends, profiles, configurações privilegiadas, Docker socket, mounts externos, drivers e nomes externos de volumes/redes são recusados. Não é um executor irrestrito de qualquer Compose.

Os recursos são limitados por container. Eles usam nomes próprios de projeto/prévia para evitar conflito. Um serviço auxiliar que termina com sucesso e é dependência `service_completed_successfully` é reconhecido durante a recuperação.

## Endereços e acesso pelo celular

Traefik usa arquivos de rotas gerados pelo gerenciador e não recebe o socket Docker. O padrão é HTTP na porta **3180**, acessível apenas pelo computador, com domínio `127.0.0.1.sslip.io`.

Com uma prévia por projeto, trocar a tarefa mantém o endereço de cada serviço. Com várias prévias, cada tarefa tem um endereço próprio. Volumes continuam pertencendo à tarefa, inclusive quando o endereço é reutilizado.

Para acessar pela mesma rede do celular:

1. Configure a senha da dashboard localmente e inicie com `pnpm --filter @oinko/dashboard start:network`.
2. Pare as prévias. Em **Ambientes → Acesso às prévias**, escolha **Rede local, incluindo celular** e um domínio que resolva para o IP do computador, por exemplo `192.168.1.10.sslip.io`.
3. Salve e inicie a prévia. Abra no celular o endereço apresentado.

O domínio depende de DNS; redes que bloqueiam respostas para IPs privados exigem um domínio no DNS local. Se o IP do computador mudar, atualize essa configuração. A autenticação da dashboard não é adicionada aos aplicativos em prévia. Este runner é local e de um administrador, sem publicação automática na internet ou TLS automático.

## Persistência e recuperação

Na raiz configurada por `OINKO_ROOT`:

```text
.harness/
  workspaces.db                   cadastro de projetos e tarefas
  environments.db                 ambientes, prévias, operações e runtime cifrado
  environments.key                chave AES-256-GCM, permissão 600
  workspaces/<projeto>/
    repositories/<repositorio>/   clone gerenciado
    tasks/<tarefa>/<repositorio>/ worktree
    home/                        cache e ferramentas do projeto
  runtime/
    jobs/                        logs limitados e mascarados
    previews/                    receitas Compose geradas
    traefik/                     rotas HTTP
    tools/                       distribuição Railpack
    runner-process.log           saída do processo do gerenciador
    runner-error.log             erro de inicialização, quando houver
```

Guarde os bancos junto com a chave e os workspaces nos backups. Volumes Docker são separados e precisam de backup próprio. Não substitua uma chave perdida: restaure a original. Todos esses arquivos ficam fora do Git.

O gerenciador usa socket Unix privado com permissão 600. A dashboard exige sessão e mesma origem nas mutações; cada ferramenta de bot valida sua autorização no projeto. Containers recebem apenas os arquivos do projeto e não recebem diretório pessoal, bancos/chaves do Oinko ou socket Docker. O isolamento é de containers locais, não uma promessa de hospedagem multiusuário hostil.

Ao reiniciar o gerenciador, prévias existentes são verificadas e as rotas são restabelecidas. Operações interrompidas ficam com falha explícita; tarefas parcialmente preparadas podem ser tentadas novamente com o mesmo ID e branch. Fechar a dashboard não interrompe operações. Builds têm prazo máximo de 15 minutos, comandos do bot de 10 minutos e a preparação da prévia verifica a disponibilidade antes de marcá-la como pronta.

O gerenciador inicia sob demanda. Não há instalação automática de serviço de login do sistema. Repositórios privados sem credencial disponível no sandbox devem ser importados de um clone local; o Oinko não encaminha automaticamente o SSH agent ou credenciais pessoais do host. A publicação no GitHub usa a GitHub App da instância, pelo processo do gerenciador e nunca pelo sandbox (seção seguinte). Parar um sandbox preserva as worktrees e a próxima operação pode iniciá-lo novamente.

## Publicação no GitHub (GitHub App)

O gerenciador publica o trabalho de uma tarefa como **draft PR**, com credenciais curtas da GitHub App da instância. Merge, aprovação, "ready for review" e deploy nunca fazem parte da operação, e não existe force push.

### Fluxo

1. **Revisão no sandbox**: calcula o hash da árvore da worktree (`tree:<sha>`, o mesmo das operações de workspace) e recusa com `revision_changed` se diferir de `expectedRevision`. Cria o objeto de commit dessa árvore exata com `git commit-tree` (sem hooks), determinístico por operação, e aponta uma ref temporária para ele. O ramo ainda não se move.
2. **Espelho do gerenciador**: `.harness/publication/<projeto>/<repo>.git` (bare, sem template, nunca montado em container) busca esse commit. Em produção, o `git upload-pack` roda **dentro do sandbox** (`ext::docker exec … git upload-pack`), então a configuração do clone — gravável pelo agente — nunca é lida no host. O espelho confere: árvore igual à revisão, fast-forward do ramo remoto (ou histórico comum com o ramo base quando o ramo ainda não existe), arquivos incluídos e segredos em **todos** os commits a enviar (linhas adicionadas, nomes de arquivo e mensagens). Achados bloqueiam com `secret_detected` e listam só caminhos e regras.
3. **Avanço local**: compare-and-swap do ramo da tarefa para o commit revisado (`update-ref novo antigo`); só o índice é atualizado, arquivos nunca.
4. **Push**: do espelho, refspec `<sha>:refs/heads/<ramo>` sem `+` nem `--force`. Não fast-forward vira `remote_conflict`, com o remoto intacto.
5. **Draft PR**: procura PRs com `head=<owner>:<ramo>` (state=all). Aberto → atualiza só título e corpo. Fechado/mesclado → `pr_closed`, exige decisão explícita (`replaceClosed=<número>`). Nenhum → cria com `draft: true`. Tarefa com vários repositórios: um PR por repositório, ligados por uma seção "Pull requests relacionados".

Autorização é lida a cada chamada e de novo antes de cada efeito: o bot precisa estar em `allowedBotIds` **e** em `programming.publisherBotIds`; só repositórios em `programming.github.repositories` podem receber push/PR. O administrador (sem `botId`) só configura a App e consulta status/instalação.

### Configurar a App

1. No GitHub, crie uma GitHub App própria da instância, sem webhook, com permissões de repositório: **Contents: Read and write**, **Pull requests: Read and write**, **Checks: Read**, **Commit statuses: Read** (Metadata: Read é automática). Nada além disso é pedido nos tokens.
2. Instale a App só nos repositórios do projeto (seleção de repositórios) e anote o **installation ID**.
3. Gere uma chave privada e envie como administrador: `{ action: 'saveGithubApp', appId, privateKeyPem }` (`apiUrl`, `webUrl` e `gitUrl` só para GitHub Enterprise ou testes). A resposta traz apenas metadados (`appId`, `fingerprint` SHA256 igual ao exibido pelo GitHub, `rotatedAt`). Apague o arquivo `.pem` baixado depois de salvar.
4. No projeto, preencha `programming.github.installationId`, `programming.github.repositories` (`repositoryId`, `owner`, `name`, `baseBranch`) e `programming.publisherBotIds`.
5. Confira com `{ action: 'githubAppStatus', verify: true }` e `{ action: 'githubInstallation', projectId }`. O resultado distingue instalação existente (`installed`) de acesso efetivo por repositório (`repositories[].access: valid | denied | unknown`) e aponta `installation_not_found`, `installation_suspended`, `insufficient_permissions`, `repositories_not_accessible`, `app_auth_failed` ou `clock_skew`. Nunca é pedido token pessoal (PAT).

### Rotação, backup e recuperação

- **Rotacionar a chave da App**: gere uma nova chave no GitHub, salve com `saveGithubApp` (substitui a anterior, descarta tokens em cache), confirme com `githubAppStatus { verify: true }` e só então exclua a chave antiga no GitHub.
- **Backup**: guarde `.harness/publication.key` (chave mestra AES-256-GCM, 32 bytes, permissão 600) **junto** com `.harness/publication.db`. A chave privada da App só existe cifrada no banco; a chave mestra nunca vai para o banco, logs ou containers. Não versione nenhum dos dois.
- **Chave mestra perdida**: `githubAppStatus` mostra `keyAvailable: false` e a publicação falha com `master_key_missing`. Restaure o backup do arquivo; sem backup, salve a App de novo com uma chave nova (a antiga fica ilegível).
- **Reinício do gerenciador**: recibos sem resultado final viram `uncertain`. Repita a operação com o mesmo `operationId` ou chame `reconcilePublication`: o remoto e os PRs são consultados antes de qualquer novo efeito.

```text
.harness/
  publication.db                  App (chave cifrada), recibos, publicações, eventos
  publication.key                 chave mestra, permissão 600
  publication/<projeto>/<repo>.git espelho bare do gerenciador (sem hooks, sem template)
  publication/.home               HOME vazio dos processos Git do gerenciador
```

### Comandos

Todos retornam `{ ok: true, … }` ou `{ ok: false, error: { code, message, retryable, operationId?, details? } }`.

| Comando                                 | Entrada                                                                                                                                   | Saída                                                                                                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saveGithubApp`                         | `appId`, `privateKeyPem`, `apiUrl?`, `webUrl?`, `gitUrl?` (admin)                                                                         | metadados como `githubAppStatus`                                                                                                                                                                |
| `githubAppStatus` / `publicationStatus` | `verify?`                                                                                                                                 | admin: `configured`, `appId`, `fingerprint`, `rotatedAt`, `keyAvailable`, `verified?`; bot: só `configured`                                                                                     |
| `githubInstallation`                    | `projectId` (admin ou bot publicador)                                                                                                     | `status`, `installed`, `installation.missingPermissions`, `repositories[].access/code`                                                                                                          |
| `reviewPublication`                     | `taskId`, `repositoryId`, `expectedRevision`                                                                                              | `verdict: ready/blocked`, `blockers`, `files`, `secrets`, `remote`, `fastForward`, `mergeBase`, `commits`                                                                                       |
| `publish`                               | `taskId`, `repositoryId`, `operationId`, `expectedRevision`, `commitMessage`, `title`, `body`, `checks?[]` (`kind`, `result`, `revision`) | `commitSha`, `commitCreated`, `push: created/fast_forward/up_to_date/reconciled`, `files`, `pullRequest`, `replayed?`, `reconciled?`                                                            |
| `ensureDraftPullRequest`                | `taskId`, `repositoryId`, `operationId`, `title`, `body`, `replaceClosed?`                                                                | `number`, `url`, `state`, `draft`, `resolution: created/updated/reconciled`, `related[]`                                                                                                        |
| `reconcilePublication`                  | `taskId`, `repositoryId`                                                                                                                  | `state: synced/differs/unpublished/unknown`, `remote`, `local`, `pullRequest`, `pullRequests`, `receipts`, `related`                                                                            |
| `inspectChecks`                         | `taskId`, `repositoryId`, `sha`                                                                                                           | `state: queued/running/passed/failed/cancelled/unknown`, `reason`, `checks[]`, `required` (lista ou `unknown`), `missingRequired`, `current`, `supersededBy?`, `fullyValidated`, `unavailable?` |
| `publicationEvents`                     | `projectId?`, `after?`, `limit?`                                                                                                          | eventos persistidos (só identificadores) e `next`                                                                                                                                               |

`publish` inclui no corpo do PR a seção de validações locais (somente checks da revisão publicada; outra revisão → `checks_stale`) e avisa que o draft não está validado integralmente até o CI concluir. `inspectChecks` nunca atribui o resultado de um SHA a outro: `current: false` e `supersededBy` quando o ramo avançou; ausência de checks é `unknown` (`reason: none`), nunca `passed`; limite de requisições e instalação revogada viram `unavailable` explícito e retomável.

### Códigos de erro

| Código                                                                                                                                                                                                                | Significado                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `admin_only`, `publisher_required`, `not_found`, `task_not_ready`, `repository_not_linked`                                                                                                                            | autorização e endereçamento (ID adivinhado recebe o mesmo `not_found` de um inexistente) |
| `github_app_not_configured`, `master_key_missing`, `invalid_private_key`                                                                                                                                              | configuração da App                                                                      |
| `installation_not_configured`, `installation_not_found` (404), `installation_suspended`, `insufficient_permissions` (403/422 de permissões), `repository_not_accessible`                                              | instalação e acesso                                                                      |
| `app_auth_failed` (401 do JWT), `clock_skew` (401 com relógio defasado > 30 s), `github_unauthorized`, `permission_denied`                                                                                            | credenciais recusadas                                                                    |
| `rate_limited` (`retryAfterSeconds`, `resetAt`), `github_timeout`, `github_unavailable`, `github_redirect`, `github_validation_failed`                                                                                | GitHub                                                                                   |
| `revision_changed`, `branch_mismatch`, `branch_moved`, `unborn_branch`, `checks_stale`, `secret_detected`, `remote_conflict`, `base_not_found`, `no_changes`, `review_too_large`, `integrity_failed`, `push_rejected` | revisão e push (bloqueios, sem efeito remoto)                                            |
| `operation_uncertain`                                                                                                                                                                                                 | o efeito pode ter ocorrido: repita com o mesmo `operationId` para reconciliar            |
| `idempotency_conflict`                                                                                                                                                                                                | mesmo `operationId` com outros parâmetros ou outro bot                                   |
| `branch_not_published`, `pr_closed`, `draft_not_supported`, `commit_not_found`                                                                                                                                        | PR e checks                                                                              |
| `sandbox_failed`, `git_failed`                                                                                                                                                                                        | falhas locais, normalmente retomáveis                                                    |

### Decisões de segurança

- Token só em variável de ambiente do processo Git do host (`GIT_CONFIG_COUNT/KEY/VALUE` → `http.<origem>.extraHeader`), restrito à origem configurada; nunca em argumentos, arquivo, config Git, log, resultado ou sandbox. Tokens pedem um único repositório e as quatro permissões mínimas, ficam só em memória e são renovados 5 min antes de expirar.
- Git do host com `GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL=/dev/null`, `HOME` vazio do gerenciador (sem `.netrc`/credenciais do usuário), `core.hooksPath=/dev/null`, `core.fsmonitor=false`, `credential.helper=` vazio, `protocol.allow=never` com liberação só do transporte da chamada, redirects desligados, submódulos desligados e `fetch.fsckObjects`. Nenhum hook, helper, filtro, `insteadOf` ou comando do repositório roda com credenciais.
- O conteúdo publicado é o objeto conferido no espelho (endereçado por conteúdo), não o que o sandbox declara.
- Idempotência: recibo persistido antes de cada efeito e resultado depois; mesmo `operationId` devolve o resultado gravado ou reconcilia (consulta ref remota e PRs) em vez de repetir. Criação de PR com resposta perdida é sempre seguida de busca antes de nova tentativa; o GitHub também recusa um segundo PR aberto para o mesmo `head`.
- Telemetria (`github_*`, `publication_*`, `git_*`, `*_pull_request_*`, `ci_*`, `operation_*`) persistida em `publication.db` com envelope `schemaVersion 1`, só identificadores (`capture: none`), retenção de 30 dias; recibos não expiram.

### Limitações

- Validação com uma GitHub App real exige credenciais do operador e um repositório de testes; os testes automatizados usam uma API simulada e um remoto `file://` local (nesse modo o cabeçalho de autenticação é omitido, mas o token da instalação ainda é emitido e todo o isolamento se mantém).
- Chamadas longas (primeiro push de um histórico grande) podem ultrapassar o prazo de 90 s do cliente; a operação continua no gerenciador e a repetição com o mesmo `operationId` devolve o resultado.
- Objetos Git LFS e repositórios de submódulos não são enviados (só os ponteiros versionados); proxies HTTP do host não são repassados ao Git de publicação.
- CI é consultado sob demanda (`inspectChecks`), sem webhook; a frequência de polling é decisão de quem chama.

## Navegador isolado (prévias e documentação)

O gerenciador mantém um Chromium próprio para bots testarem prévias e lerem documentação pública. Não há perfil pessoal, credencial ou arquivo do host no navegador.

- **Imagem fixada**: `mcr.microsoft.com/playwright:v1.63.0-noble`, igual ao `playwright-core` do gerenciador. A imagem derivada `oinko-browser:1.63.0-<hash>` só acrescenta o `playwright-core` do próprio gerenciador e dois scripts. O primeiro uso baixa cerca de 1 GB; enquanto isso as sessões respondem `browser_unavailable` (`reason: image_pulling`, `retryable: true`). Para baixar antes: `docker pull mcr.microsoft.com/playwright:v1.63.0-noble`. Ao iniciar, o gerenciador confere a versão do Chromium, o `/ms-playwright/.docker-info` e a sandbox; qualquer divergência vira `browser_unavailable`.
- **Container**: usuário `pwuser` (não root), `--cap-drop=ALL`, `no-new-privileges`, raiz somente leitura, `/tmp` em tmpfs, 2 CPUs, 2 GB, 1024 PIDs, sem bind mounts, sem socket Docker. A sandbox do Chromium fica **ligada**: usa o perfil seccomp documentado pelo Playwright com uma regra extra para `chroot` (o kernel continua exigindo a capability, que só existe no namespace criado pelo Chromium). Sem a sandbox, o navegador não é usado (`reason: sandbox_unavailable`).
- **Rede**: o navegador fica numa rede Docker `--internal`. O único vizinho é um relay que encaminha apenas para o proxy de saída do gerenciador e expõe o controle Playwright em `127.0.0.1`. Cada sessão tem credencial própria no proxy; o proxy resolve DNS uma vez e conecta ao IP validado.
- **Sessões**: uma por bot + run + projeto + tipo (`docs` ou `test`), cada uma com contexto próprio de cookies, storage e cache; downloads desabilitados. Só o mesmo bot e run agem na sessão; o administrador consulta (`browserStatus`) e encerra (`browserClose`). Revogar o bot do projeto ou desabilitar o navegador encerra a sessão na próxima requisição.
- **Ciclo de vida**: o container sobe na primeira sessão e para 10 minutos após a última (`OINKO_BROWSER_IDLE_MS`). Sessões sem ação por 20 minutos expiram (`OINKO_BROWSER_SESSION_IDLE_MS`). Queda do container marca as sessões `failed` (`browser_crashed`); reinício do gerenciador remove containers órfãos do namespace e marca sessões ativas `failed` (`runner_restarted`).

Configuração no projeto (`programming.browser`): `enabled`, `allowedOrigins`, `publicDocs` e `credentials` (nomes habilitados).

| Destino                                                            | `test` | `docs`                | Regra/código                             |
| ------------------------------------------------------------------ | ------ | --------------------- | ---------------------------------------- |
| Prévia `ready` do próprio projeto (via Traefik local)              | sim    | sim                   | `preview`                                |
| Origem de `allowedOrigins` (IP privado só se escrito como IP)      | sim    | sim                   | `allowed_origin`                         |
| Internet pública (portas 80/443, todos os IPs resolvidos públicos) | não    | sim, com `publicDocs` | `public_docs`                            |
| Loopback, RFC 1918, CGNAT, ULA, IPv4 mapeado privado               | não    | não                   | `private_address`                        |
| Metadados, link-local, 0.0.0.0/8, multicast, reservados            | nunca  | nunca                 | `metadata_address` / `forbidden_address` |
| Prévia de outro projeto ou prévia parada                           | não    | não                   | negado como qualquer endereço privado    |

Credenciais de teste (somente administrador): `browserSaveCredential { projectId, name, username, password }` (mínimo de 4 caracteres), `browserCredentials`, `browserDeleteCredential`. Ficam em `.harness/browser.db` cifradas com `.harness/browser.key` (AES-256-GCM, permissão 600, ligadas ao projeto e ao nome). Nenhum comando devolve os valores. `browserFill { credential: { name, field } }` só funciona em sessão `test` do projeto e com o nome listado em `programming.browser.credentials`; o resultado traz só o nome. Valores atuais e anteriores são mascarados em textos, URLs, console e rede, e os campos preenchidos são mascarados nas capturas.

Comandos (todos com `sessionId` e `runId`, explícito ou vindo da correlação): `browserSession`, `browserNavigate`, `browserSnapshot` (texto limitado, elementos com refs `e1…` ligadas ao `snapshotId`; `full: text|html` devolve o conteúdo em `artifact`), `browserClick`, `browserFill`, `browserWait`, `browserScreenshot` (`artifact` PNG/JPEG em base64, até 1 MB), `browserDiagnostics` (erros de console e requisições com falha/4xx/5xx desde a última chamada), `browserClose`, `browserStatus`. Falhas voltam como `{ error: { code, message, retryable, ... } }`; os códigos estão em `src/browser/errors.ts`. Ref de snapshot antigo ou de página alterada falha com `stale_element`; envio interrompido volta `uncertain: true`. Cada resultado traz `decisions` (`origin`, `rule`, `allowed`, `code`, `count`) para os eventos `browser_navigation_allowed/denied`; navegações para prévias trazem `preview` (`previewId`, `taskId`, `environmentId`, `serviceId`, `previewRevision`, `previewCreatedAt`).

Limites conhecidos: as sessões compartilham um processo de navegador (um comprometimento do processo principal do Chromium, além do renderer, alcançaria outras sessões). Em Linux, o proxy escuta no gateway da rede `bridge` (`OINKO_BROWSER_PROXY_HOST` altera); esse caminho não foi validado nesta entrega, apenas Docker Desktop no macOS.

## Verificação

```bash
pnpm build:packages
pnpm --filter @oinko/environments test
pnpm --filter @oinko/environments test:docker   # inclui tests/browser.e2e.test.ts
OINKO_DOCKER_TEST=1 pnpm --filter @oinko/environments exec vitest run tests/publication-docker.e2e.test.ts
OINKO_DOCKER_TEST=1 pnpm --filter @oinko/bots exec vitest run tests/programming.test.ts
OINKO_RAILPACK_TEST=1 pnpm --filter @oinko/environments exec vitest run tests/railpack.test.ts
OINKO_DOCKER_TEST=1 pnpm --filter @oinko/dashboard exec playwright test --trace=off
```

Os testes Docker usam raízes temporárias e removem seus containers e dados de teste. O build Railpack baixa imagens e pode consumir alguns GB de cache. A suíte normal não baixa/builda imagens. Evidências da entrega ficam em [docs/dashboard/ENVIRONMENTS-DELIVERY.md](../../docs/dashboard/ENVIRONMENTS-DELIVERY.md).
