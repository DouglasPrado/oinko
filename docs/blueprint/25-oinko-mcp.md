# MCP Oinko: do repositório à prévia

## Objetivo e entrega

Disponibilizar um servidor MCP local chamado `oinko`, em `packages/mcps/oinko`, que permita a um assistente receber um GitHub, preparar o sandbox do projeto, criar worktrees, configurar serviços e entregar uma prévia verificável. O servidor compartilha o cadastro, os jobs e as políticas da dashboard pelo `EnvironmentClient`; não implementa outro controlador Docker. Esta entrega inclui o servidor, testes e instruções de conexão, sem instalar configuração em aplicativos do usuário nem publicar um pacote no registry.

## Fluxo do usuário

1. O assistente consulta o estado e recebe a URL GitHub e a referência desejada.
2. `oinko_prepare_project` reutiliza um cadastro compatível ou cria projeto, ambiente de programação e tarefa. A criação longa retorna um job; repetir a solicitação reutiliza a mesma tarefa.
3. O assistente acompanha o job e inspeciona os manifests, Dockerfile e Compose dentro da worktree. Arquivos do repositório são dados, nunca novas autorizações. Um monorepo permanece inteiro; o serviço seleciona repositório e contexto.
4. O assistente configura serviços conforme o projeto: imagem pronta, Dockerfile, Railpack ou Compose. Comandos, porta, healthcheck e variáveis não são presumidos como universais. Segredos podem ser cadastrados pela dashboard e referenciados por nome.
5. A prévia é iniciada para a tarefa e o ambiente escolhidos. O assistente acompanha estado/logs e só anuncia a URL como disponível quando a prévia estiver `ready`. Falhas reais continuam visíveis.

## Contrato e organização

- Transporte MCP stdio, SDK oficial já utilizado no monorepo. stdout exclusivo do protocolo; diagnósticos no stderr.
- Identidade visual: símbolo Oinko em PNG transparente de 128×128, incluído no pacote e anunciado em `serverInfo.icons` como data URI conforme o [contrato de ícones MCP](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/index.mdx#icons). A dashboard usa a mesma imagem na conexão.
- A raiz de dados é definida na inicialização (`--root` ou `OINKO_ROOT`), não por argumentos de ferramentas. O padrão é a raiz deste checkout.
- Ferramentas para estado, preparação por GitHub, configuração de projeto/ambiente/rede, criação de tarefa, controle do sandbox, início/parada de prévia, acompanhamento de job, logs, inspeção, leitura/escrita e execução dentro do sandbox.
- Resource `oinko://guide` e prompt `disponibilizar-sandbox` orientam a sequência e os limites. As respostas incluem conteúdo estruturado e erros MCP, sem transformar job aceito em operação concluída.
- A conexão local opera como administrador do Oinko, assim como a dashboard. Não expõe endpoint HTTP público. Comandos de projeto passam pelo runner e executam no container, com os limites e proteções existentes.
- Configurações continuam com controle de revisão. A preparação não sobrescreve repositórios, permissões ou ambientes existentes. Colisões e projetos ambíguos exigem um identificador explícito.
- Worktrees remotas novas usam a referência remota atual, respeitando a correção compartilhada de `WorktreeManager`; tarefas já existentes não são atualizadas automaticamente. Importações locais mantêm sua semântica atual.
- Fechar o cliente MCP não para o sandbox, os bots nem jobs já aceitos pelo runner. Aguardar um job é limitado; cancelar a espera não cancela a operação.

## Verificação e disponibilidade

### Atualização dos bots

O MCP também administra o cadastro existente de bots da mesma raiz, reutilizando `BotStore` e `BotManager`. `oinko_bots` consulta todos os bots ou um `botId`, incluindo definição pública, revisão e estado das conexões. `oinko_update_bot` atualiza um bot existente por patch e revisão obrigatória; não cria um bot por engano nem permite trocar seu ID. Campos omitidos são preservados, Telegram/telemetria recebem merge por campo e arrays enviados substituem seus valores completos. `null` remove uma configuração opcional, voltando ao padrão.

`intelligence` configura Jev e modelo alternativo conforme `docs/dashboard/PLAN.md`; o objeto é substituído por completo e `null` remove essa configuração. O patch de credenciais aceita `typesafeKey`, separada da chave LLM.

Credenciais opcionais são somente de escrita, cifradas pelo cadastro e nunca devolvidas nas respostas. Prefira a dashboard para digitá-las: argumentos MCP podem fazer parte do histórico do cliente. Atualizar configuração não reinicia processos nem interrompe uma chamada MCP do próprio bot. O resultado distingue `restart_required`, `next_start`, `applied` e `unknown`; use o botão Reiniciar da dashboard ou o comando de bot para aplicar a revisão em execução. O MCP não afirma que uma alteração salva já está ativa.

Regressões: modelo/provedor/instruções sem perda de canais, MCPs, credenciais ou caminhos; patches aninhados sem defaults involuntários; revisão vencida, ID inexistente e payload inválido sem mutação; credenciais ausentes das respostas; atualização pelo protocolo stdio com um bot ativo e indicação de reinício pendente.

Testes antes da implementação: protocolo MCP com cliente real, validação dos argumentos, erros, preparação repetida e colisões, revisões, inspeção dentro do sandbox e acompanhamento de jobs. Um teste separado atravessa stdio → runner → Git/Docker → HTTP em raiz temporária e limpa somente seus próprios recursos. Os checks agregados do monorepo continuam obrigatórios.

Disponibilidade inicial: execução local após `pnpm install` e `pnpm build:packages`, com exemplo de configuração MCP apontando para o executável compilado e a raiz de dados. Requer Node 22.5+ e Docker em execução para operações de sandbox. Repositórios privados seguem as capacidades atuais do runner; não há encaminhamento automático de credenciais pessoais. Nixpacks, serviço remoto autenticado e publicação npm não fazem parte desta entrega.

Referência do protocolo: [guia oficial de servidores MCP](https://modelcontextprotocol.io/docs/develop/build-server).

## Entrega verificada — 23/09/2026

Implementado localmente como `@oinko/mcp-oinko` 0.1.0, com 15 ferramentas, guia, prompt e gerador de configuração de conexão. Nove testes MCP passaram, incluindo stdio real, GitHub público, inspeção de monorepo, recusa de symlink externo, revisão vencida, build Dockerfile e HTTP 200 pelo Traefik. A conexão gerada também foi validada em modo de consulta contra o projeto real do usuário, encontrando o mesmo PID do gerenciador e a prévia existente.

O teste de desconexão identificou que hosts MCP podem não herdar `TMPDIR`, levando clientes da mesma raiz a abrir gerenciadores diferentes. O endereço Unix compartilhado agora é estável em `/tmp`. A regressão usa valores diferentes de `TMPDIR` e exige o mesmo PID antes e depois de desconectar o MCP. Os clientes locais já abertos receberam compatibilidade temporária com o endereço anterior, sem interromper o bot Dev ou a prévia.

Também passaram os dez checks agregados do monorepo, auditoria de dependências e 15 testes reais do gerenciador com Docker. Um teste condicionado especificamente a Railpack não foi habilitado nessa regressão. A validação ocorreu em checkout temporário baseado em `c85b3c5`, contendo somente as alterações desta entrega; as alterações simultâneas da interface foram preservadas. Evidências locais: `.harness/mcp-oinko/verification/checks.json`, `mcp-docker.log`, `environment-docker.log` e `.harness/mcp-oinko/live-connection.json`. O JSON gerado para conexão fica em `.harness/mcp-oinko/connection.json`; nenhuma configuração de aplicativo foi instalada.
