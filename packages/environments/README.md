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

O gerenciador inicia sob demanda. Não há instalação automática de serviço de login do sistema. Repositórios privados sem credencial disponível no sandbox devem ser importados de um clone local; o Oinko não encaminha automaticamente o SSH agent ou credenciais pessoais do host. Publicar commits exige configurar essa autorização no ambiente. Parar um sandbox preserva as worktrees e a próxima operação pode iniciá-lo novamente.

## Verificação

```bash
pnpm build:packages
pnpm --filter @oinko/environments test
pnpm --filter @oinko/environments test:docker
OINKO_DOCKER_TEST=1 pnpm --filter @oinko/bots exec vitest run tests/programming.test.ts
OINKO_RAILPACK_TEST=1 pnpm --filter @oinko/environments exec vitest run tests/railpack.test.ts
OINKO_DOCKER_TEST=1 pnpm --filter @oinko/dashboard exec playwright test --trace=off
```

Os testes Docker usam raízes temporárias e removem seus containers e dados de teste. O build Railpack baixa imagens e pode consumir alguns GB de cache. A suíte normal não baixa/builda imagens. Evidências da entrega ficam em [docs/dashboard/ENVIRONMENTS-DELIVERY.md](../../docs/dashboard/ENVIRONMENTS-DELIVERY.md).
