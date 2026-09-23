# MCP Oinko

Servidor MCP local chamado **oinko** para preparar projetos a partir do GitHub e manipular sandboxes, worktrees, builds e prévias. Usa o mesmo gerenciador e os mesmos dados da dashboard. Não é necessário criar outro bot nem manter a dashboard aberta.

O servidor anuncia o símbolo do Oinko em PNG de 128×128, com fundo transparente, no campo `serverInfo.icons` do handshake. A imagem de `assets/icon.png` vai embutida como data URI, sem depender de um site externo. Clientes que exibem ícones MCP podem usá-la; a dashboard usa a mesma imagem na conexão `oinko`.

## Preparar e conectar

Requisitos: este checkout do monorepo, Node 22.5+ (use `.nvmrc`), pnpm e Docker. O servidor usa stdio; o aplicativo cliente inicia e encerra o processo MCP quando necessário.

Na raiz do Oinko:

```bash
pnpm install --frozen-lockfile
pnpm build:packages
node packages/mcps/oinko/dist/cli.js --print-config
```

O último comando imprime um JSON de conexão pronto para esta máquina, com caminhos absolutos para Node, o servidor e a raiz de dados. Copie a entrada `oinko` para a configuração MCP do cliente. Clientes com outro formato de configuração usam os mesmos campos `command`, `args` e `env`. Não execute `--print-config` como comando do servidor no cliente: esse argumento apenas gera a configuração.

Exemplo genérico:

```json
{
  "mcpServers": {
    "oinko": {
      "command": "/caminho/absoluto/para/node",
      "args": ["/caminho/oinko/packages/mcps/oinko/dist/cli.js", "--root", "/caminho/oinko"],
      "env": {
        "PATH": "/caminho/para/node/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
      }
    }
  }
}
```

Use a mesma raiz de dados da dashboard. `--root` tem precedência sobre `OINKO_ROOT`; sem ambos, o servidor usa a raiz deste checkout. O `PATH` precisa localizar Docker e Git. O gerador de configuração preserva o PATH do terminal em que foi executado.

O pacote é privado do workspace: está disponível localmente, não publicado no npm. Não use `npx @oinko/mcp-oinko` esperando baixar esta entrega. Nenhuma configuração de aplicativo é alterada pelo servidor ou pelo gerador de JSON.

Na primeira atualização para esta versão, reinicie dashboard, gerenciador e clientes Oinko já abertos. A conexão Unix agora usa um endereço estável em `/tmp`, para que clientes MCP que não herdam `TMPDIR` encontrem o mesmo gerenciador. A raiz de dados, worktrees, volumes e bancos permanecem os mesmos.

## Pedidos que o usuário pode fazer

> Use o MCP oinko para preparar uma sandbox de https://github.com/minha-conta/meu-projeto. Inspecione o projeto, configure o serviço web e disponibilize uma prévia para eu testar.

> Crie outra tarefa no projeto, execute os testes nessa worktree e suba a prévia dela.

> Veja por que a prévia falhou, mostre os logs relevantes e corrija a configuração.

O cliente também pode oferecer o prompt `disponibilizar-sandbox`, com argumentos `github` e `ref` opcional. O resource `oinko://guide` descreve o fluxo completo.

## Ferramentas

| Ferramenta                    | Uso                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `oinko_status`                | Projetos, ambientes, tarefas, jobs, containers de programação e URLs; aceita filtro por projeto.           |
| `oinko_prepare_project`       | GitHub → projeto/ambiente/tarefa. Aceita `owner/repo` ou URL raiz HTTPS e reutiliza cadastros compatíveis. |
| `oinko_configure_project`     | Definição completa de projeto, repositórios, ambientes e bots autorizados, com revisão.                    |
| `oinko_configure_environment` | CPU/memória, rede do sandbox, serviços, Compose, builders, variáveis, volumes e segredos, com revisão.     |
| `oinko_configure_network`     | Porta/domínio/bind globais das prévias, com revisão.                                                       |
| `oinko_create_task`           | Nova branch/worktree em cada repositório do projeto.                                                       |
| `oinko_sandbox`               | Iniciar/parar o container de programação, preservando arquivos.                                            |
| `oinko_inspect_repository`    | Manifests e receitas dentro da worktree, sem executar código do repositório nem ler `.env`.                |
| `oinko_start_preview`         | Construir/iniciar a prévia da tarefa no ambiente selecionado.                                              |
| `oinko_stop_preview`          | Parar a prévia, preservando volumes e worktree.                                                            |
| `oinko_job`                   | Consultar job; `waitSeconds` de 0 a 20. Falha continua sendo falha.                                        |
| `oinko_logs`                  | Final dos logs de job/prévia, com limite configurável de texto.                                            |
| `oinko_exec`                  | Terminal/Git/testes dentro do sandbox, timeout de 1 a 600 segundos.                                        |
| `oinko_read_file`             | Ler até 200 KB de um caminho relativo à worktree.                                                          |
| `oinko_write_file`            | Criar/substituir arquivo relativo à worktree.                                                              |

### Sequência mínima

1. `oinko_prepare_project` com `repositoryUrl`. A configuração inicial prepara apenas o ambiente de programação, sem inventar o comando da aplicação.
2. Acompanhe o `job.id` com `oinko_job` até `succeeded`; se já havia tarefa em preparação, consulte `oinko_status`.
3. Use `oinko_inspect_repository` com os IDs da tarefa e do repositório retornados. Inspecione monorepos antes de escolher contexto e comandos.
4. Consulte `oinko_status` e envie a definição completa do ambiente para `oinko_configure_environment`, usando sua revisão atual. Por exemplo, um serviço Dockerfile pode ter `id: "web"`, `repositoryId: "app"`, `builder: "dockerfile"`, `context: "."`, `port: 3000`, `expose: true`. Porta, contexto e healthcheck dependem do projeto real.
5. Use `oinko_start_preview` e acompanhe o job. Entregue a URL apenas quando a prévia estiver `ready`.

O assistente escolhe/configura serviços com base no código: Dockerfile, Railpack, imagens prontas ou Compose. Nixpacks/CNB não estão implementados. Para projetos com vários repositórios ou origens locais, use `oinko_configure_project`; a preparação simplificada aceita GitHub.

## Comportamento e limites

- A conexão é administrativa e local, equivalente ao acesso administrativo da dashboard. Não existe listener HTTP público do MCP nem cópia separada do cadastro.
- Leituras, escritas, inspeção e terminal passam pelo runner e pelo container do projeto. O MCP não recebe uma raiz arbitrária por chamada de ferramenta e não executa comandos do repositório no host.
- Revisões impedem sobrescritas concorrentes. Repetir a preparação não redefine permissões, configurações de ambiente nem trabalho existente. Um repositório em vários projetos exige `projectId` explícito.
- `HEAD` de um projeto HTTPS novo acompanha o remoto na criação das worktrees. Tarefas existentes mantêm seu código. Importações locais mantêm o snapshot importado.
- Jobs são assíncronos. A espera MCP pode encerrar enquanto o job continua. Configure um timeout de ferramenta de até 660 segundos no cliente se utilizar comandos longos; builds são acompanhados por chamadas curtas a `oinko_job`.
- Fechar o MCP não para o runner nem containers. O limite padrão de uma prévia por ambiente pode parar a prévia anterior ao iniciar outra; arquivos e volumes permanecem.
- Credenciais Git pessoais não são encaminhadas automaticamente. Segredos do ambiente podem ser cadastrados pela dashboard e referenciados por nome. O runner mascara os valores cadastrados nos logs; não despeje outros segredos em comandos/logs.
- Autenticação da aplicação de prévia é responsabilidade da própria aplicação. Criar uma worktree não copia usuários, senhas ou dados da dashboard principal.
- A disponibilidade pela rede depende das configurações existentes de Traefik, domínio e bind. Para celular, use um endereço LAN, não o localhost do celular.

## Verificação

```bash
pnpm build:packages
pnpm --filter @oinko/mcp-oinko test
pnpm --filter @oinko/mcp-oinko test:docker
```

O teste padrão inclui cliente MCP real em memória e processo stdio real. O teste Docker usa uma raiz temporária, clona um GitHub público, cria/inspeciona/edita a worktree, executa Git, constrói uma imagem, verifica HTTP 200 por Traefik e comprova que desconectar o MCP preserva o runner e a prévia. Só os recursos da fixture são removidos. Não representa teste com LLM pago, GitHub privado ou aceitação em celular físico.

[Planejamento e contrato](../../../docs/blueprint/25-oinko-mcp.md) · [Guia oficial MCP](https://modelcontextprotocol.io/docs/develop/build-server)
