# Validação completa do sandbox

Escopo: casos de uso implementados no [blueprint de projetos, ambientes e prévias](../blueprint/24-workspaces-environments.md), incluindo caminhos de sucesso, falha, autorização, isolamento, persistência e recuperação. A matriz abaixo cobre os 14 comandos do runner, os três builders disponíveis e os dois modos de execução. Não representa uma prova de todas as combinações possíveis de programas ou falhas do sistema operacional.

## Como reproduzir

Na raiz, com Node 22, pnpm e Docker/Compose/Buildx disponíveis:

```sh
pnpm test:sandbox
```

O comando compila os pacotes, testa workspaces, executa todos os testes de ambientes com Docker e Railpack habilitados, testa os bots com Docker e executa a dashboard de produção no Playwright. Imagens públicas, um repositório público GitHub e o binário Railpack com checksum são obtidos pela rede. Não requer chave de LLM nem conta Telegram. `pnpm test` continua sendo a suíte sem dependência obrigatória de Docker; seus testes condicionais ignorados não são evidência de aprovação do sandbox.

Os testes usam diretórios temporários, bancos próprios, portas dedicadas e nomes Docker derivados da raiz da fixture. A dashboard de testes usa `.next-e2e`, separada do build servido ao usuário. A indisponibilidade de Docker é provocada por um endpoint inválido somente no processo da fixture. Nenhum teste desliga o daemon ou remove recursos de outros projetos. A limpeza das fixtures do runner verifica ausência dos seus containers, redes, volumes e tags de imagem. Caches compartilhados de build/imagens base podem permanecer.

## Fontes de evidência

| Referência | Arquivo | Natureza |
| --- | --- | --- |
| R | `packages/environments/tests/runner.e2e.test.ts` | Cliente real → socket privado → processo separado do runner distribuído → Git/Docker/HTTP reais. |
| F | `packages/environments/tests/failures.e2e.test.ts` | Mesmo caminho real, incluindo receitas hostis e falhas operacionais. |
| D | `packages/environments/tests/docker.test.ts` | Docker, Compose, volumes e Traefik reais; controlador/gerenciador instanciados pelo teste. |
| P | `packages/environments/tests/railpack.test.ts` | Download/checksum, build Railpack e container reais. |
| B | `packages/bots/tests/programming.test.ts` | Ferramentas e Agent completos, Git/Docker reais no caso condicionado; somente o modelo é determinístico. Os testes também distinguem o mapeamento unitário de ferramentas. |
| UI | `apps/dashboard/tests/e2e/workspaces.spec.ts` | Navegador → dashboard → runner → Docker → prévia HTTP reais, em desktop e viewport móvel. |
| UI-F | `apps/dashboard/tests/e2e/sandbox-recovery.spec.ts` | Erros reais de Git/build, correção pelo terminal, retomada e fechamento da página; autenticação, validação de entrada e revisão pela API. |
| U | `packages/workspaces/tests`, `packages/environments/tests/{policies,compose,service,command,sandbox-status,project-environments}.test.ts` | Contratos, políticas, criptografia, persistência e integrações adicionais; alguns executores são simulados. |

As fixtures de `project-hierarchy.spec.ts` interceptam estados de prévia para testar navegação/contexto. Elas não substituem UI/UI-F como prova de infraestrutura. Os demais testes de navegador verificam também regressões de bots, autenticação e telemetria.

## Matriz de casos de uso

| Caso/invariante | Evidência executável e resultado esperado |
| --- | --- |
| Projeto antes de ambiente | R `persists project-first…`: cadastro persiste; tarefa falha com explicação até vincular ambiente; mesmo ID pode ser tentado novamente. UI cria projeto antes da configuração. |
| Cadastro, edição e conflitos | R, UI e UI-F: `saveProject`, `saveEnvironment`, `saveSettings`, campos persistidos, revisão antiga rejeitada sem sobrescrever o valor atual. |
| Reutilização entre projetos | UI: ambiente configurado uma vez, vinculado aos projetos desktop/mobile; permissões e referência Git editadas pela interface. |
| Mais de um ambiente por projeto | R `builds a monorepo target…`, D `serves two worktrees…`: mesma tarefa em ambientes distintos, IDs/rotas/limites independentes. U verifica também troca do ambiente padrão preservando a identidade. |
| Um ou vários repositórios, monorepo | R `isolates multi-repository…`, UI: branch em cada repositório, app acessa pacote compartilhado; alterações não atingem checkout original nem segunda worktree. |
| Origem local e HTTPS | R `clones an HTTPS repository…`: clone público dentro do container e leitura real do README. D verifica que credencial do remote local não é herdada. |
| Referência Git inexistente | R: job e tarefa ficam `failed`, com referência na mensagem. UI-F: origem local ausente pode ser corrigida e a mesma tarefa preparada novamente. |
| IDs, branches, paths e cadastro inválidos | R `rejects malformed…`, U: traversal, opção Git, campos inválidos, repositórios duplicados, dependências ausentes/cíclicas e recursos inexistentes são recusados. |
| Edição das origens depois de criar tarefas | R: alteração recusada explicitamente; cópias e metadados existentes são preservados. |
| Criação concorrente e ID duplicado | R: duas tarefas enfileiradas no projeto recebem worktrees distintas; reutilizar ID já pronto é recusado. U verifica inicialização SQLite concorrente. |
| Iniciar, parar e reiniciar sandbox | R: `startSandbox` e `stopSandbox`, parada repetida, leitura que reativa o sandbox e retenção dos arquivos Git. |
| Imagem do workspace configurável | R `honors the configured workspace image…`: usa imagem selecionada, informa falta de Git, troca a imagem e prepara novamente a mesma tarefa. |
| CPU, memória, rede e mounts | R inspeciona configuração real aplicada, recria container ao editar limites e mantém arquivos; F verifica redes internas e ausência de portas publicadas nos serviços. |
| Sem acesso automático a host/segredos/socket Docker | R inspeciona único bind em `/workspace`, usuário/restrições e ausência dos caminhos do host; F inspeciona mounts dos serviços. Shell tem acesso ao workspace inteiro do projeto autorizado; a fronteira de isolamento é o projeto. |
| Terminal/Git/testes | R e B: stdout/stderr, exit code não zero, commit/branch reais; timeout de shell termina com código 124. UI executa comandos dentro do sandbox. |
| Leitura/escrita de arquivos | R: UTF-8 pequeno e arquivo de 160 KB com emojis atravessando blocos HTTP/stdin/stdout, diretório aninhado, arquivo ausente, limite de leitura de 200 KB, repositório desconhecido, tarefa ainda não pronta. |
| Symlinks e traversal | R `rejects existing and dangling…`: leitura/escrita fora da worktree recusada, link interno permitido, destino externo permanece intacto. F recusa contextos/mounts com escape. |
| Autorização de cada operação | R: bot não autorizado não cria tarefa, inicia/para sandbox, lê/escreve/executa, inicia/para prévia ou lê logs. Estado filtra projetos/tarefas/ambientes e omite configurações administrativas. |
| Revogação de acesso | R: atualização da autorização remove tarefas do estado do bot e bloqueia nova leitura. |
| Administração reservada | R: bots não executam os três comandos de configuração; socket tem modo `0600`. |
| Autenticação e mesma origem | UI/UI-F: sessão ausente, origem externa/ausente, conteúdo não JSON, payload grande, comando inválido e revisão vencida são recusados. |
| Imagem pronta | R/F/B: serviço executa imagem pública, comando personalizado, com ou sem rota; imagem inexistente falha. |
| Dockerfile | R/F/D/UI: monorepo, target de múltiplos estágios, build args públicos, rebuild incorpora alteração; contexto, arquivo ou target ausente e comando de build com erro falham. |
| Railpack | R `builds a Railpack subdirectory…`: contexto de subpasta, build/start personalizados, variável pública de build, HTTP via Traefik e parada. P cobre diretamente instalação/build/execução. |
| Modo image versus development | R: arquivo editado só aparece depois do rebuild de imagem; ambiente development lê atualização imediatamente. D confirma bind de código importado por Compose. |
| Compose e dependências | F: target/args, env_file, expansão de variável no container, Redis saudável, volume interno; D: dependência que termina com sucesso é aceita também após reinício. |
| Compose sem herdar privilégios | F: 21 receitas recusadas antes de criar containers; detalhes abaixo. Portas/labels fornecidas pelo repositório não publicam serviços automaticamente. |
| Segredos | R/F/UI: nomes expostos sem valores, dados cifrados no banco, chave `0600`, edição preserva segredos, rotação aplica novo valor após rebuild e mantém logs antigos mascarados, remoção bloqueia prévia que exige o segredo; segredo ausente/não selecionado é recusado. U cobre recuperação/perda da chave e configuração cifrada grande. |
| Traefik e disponibilidade HTTP | R/F/D/UI: resposta real da worktree correta; somente serviços selecionados recebem URL; container em execução com HTTP 503 termina como falha após timeout. |
| Acesso de rede | F inspeciona bind `0.0.0.0` e porta; UI abre URLs das prévias. Alterar configuração de rede com prévia ativa é recusado em R. |
| Concorrência e troca de worktree | D: duas prévias simultâneas têm conteúdo/recursos distintos; limite 1 para anterior e preserva URL do ambiente, sem parar prévia em outro ambiente. |
| Logs e estados | R/F/B/UI-F: `jobLogs`, `previewLogs`, `queued/running/succeeded/failed` e `building/starting/ready/stopped/failed` persistidos; erro não vira “disponível”. |
| Parada e dados persistentes | D: Redis mantém dado após parar/iniciar; outra prévia continua respondendo. R: parada repetida é segura. |
| Runner reiniciado | R: processo morto com job realmente enfileirado marca job/tarefa interrompidos e permite nova tentativa; prévias saudáveis voltam a responder após reinício normal. |
| Serviço removido externamente | F: remoção de dependência Docker seguida de reconciliação produz `failed`. D confirma que uma prévia com build falho continua falha após reinício. |
| Docker indisponível | R usa socket Docker inexistente em processo isolado: estado `unavailable`, start/stop falham, novo processo com endpoint correto recupera. |
| Porta ocupada | R reserva a porta com outro container da fixture: prévia falha sem URL e funciona depois de liberar a porta. |
| Falha de healthcheck | F: Compose detecta `unhealthy`, editar receita permite nova tentativa bem-sucedida; timeout HTTP é validado separadamente. |
| Fechar a dashboard durante operação | UI-F fecha a página após o runner aceitar o build, abre outra e observa a mesma operação concluída, em desktop/mobile. |
| Bot programador de ponta a ponta | B: uma chamada a `Agent.chat` executa status → tarefa → status → escrita → leitura → Git/commit → prévia → status → logs → parada → status, usando ferramentas/socket/Docker reais e modelo roteirizado. Também testa ambiente explícito e identidade da prévia. |
| Desktop e celular | UI/UI-F: criar, configurar, preparar, terminal, abrir prévia, observar falha, recuperar, logs e parar; screenshots e ausência de overflow horizontal. |
| Limpeza isolada | R/F: teardown elimina e verifica somente recursos da fixture; D remove também tags construídas, mantendo imagens base/caches compartilhados. |

Receitas Compose recusadas em F: `privileged`, rede do host, PID do host, IPC do host, dispositivos, capacidades adicionais, socket Docker, mount absoluto, mount no diretório pai, mount por symlink externo, volume externo, driver de volume, rede externa, `include`, `extends`, env_file externo, variável implícita do host, segredo não selecionado, contexto externo, Dockerfile externo e SSH de build não autorizado.

## Defeitos encontrados e corrigidos

O teste de escrita por symlink pendente falhou antes da correção: `existsSync` devolvia falso para um link cujo destino não existia, permitindo criar um arquivo fora da worktree, ainda dentro do container. A validação agora identifica o link com `lstatSync` e exige resolver um destino permitido antes de escrever. O mesmo teste comprova a recusa, a integridade do destino externo e a continuidade do suporte ao link interno válido.

O teste de arquivo UTF-8 grande também falhou: cada bloco de bytes era convertido isoladamente em texto, corrompendo caracteres multibyte. O runner HTTP, o stdin do processo de arquivo e stdout/stderr de comandos agora usam decodificação incremental UTF-8. Além do teste real de 160 KB, um teste unitário força a divisão de um emoji e de um acento entre blocos de stdout/stderr. Ambos falharam antes da correção e passaram depois.

O primeiro teste de porta ocupada usava um listener nativo. Docker Desktop conseguiu publicar a porta apesar dele, portanto essa fixture não provava conflito Docker. O teste foi corrigido para reservar o mapeamento com outro container isolado; não houve mudança de produto para “fazer o teste passar”.

## Execução e limites

Execução local em 23/09/2026, macOS arm64, Node 22.23.0, Docker 29.7.2, Railpack 0.39.0 e Chromium. Evidências locais em `.harness/sandbox-e2e/`: logs das regressões antes/depois, `final-*.log`, `api-repeat.log` e `browser-confirm-{1,2}.log`; screenshots preservados em `.harness/sandbox-e2e/evidence/`. Esses arquivos são artefatos locais ignorados pelo Git; os testes e este relatório estão versionados.

A validação final foi executada em uma worktree temporária baseada em `f0b58fb`, com somente as alterações desta entrega. Havia alterações simultâneas de design na dashboard do checkout principal; elas foram preservadas e não fazem parte do snapshot validado aqui.

| Verificação | Resultado |
| --- | --- |
| Workspaces | 6 testes aprovados. |
| Ambientes | 67 aprovados, incluindo os 49 testes condicionados a Docker/Railpack, habilitados nesta execução. |
| Bots | 10 aprovados, incluindo o ciclo completo do Agent com ferramentas reais. |
| Navegador | 26 aprovados em cada uma de duas rodadas completas de confirmação. |
| Total dos casos distintos acima | 109 casos aprovados nas últimas execuções de cada suíte; inclui testes unitários, integração e E2E, não apenas E2E. |
| Repetição da API | 12/12 aprovações adicionais, sem contar novamente no total de casos distintos. |
| Regressão geral | 1.588 testes aprovados e 51 ignorados na execução padrão; os condicionais de sandbox foram habilitados nas suítes acima. Cobertura de statements do core: 92,07%. |
| Qualidade | Lint, tipos, build, formato, duplicação, código morto, tamanho, documentação da API e validação de publicação aprovados. |
| Dependências e segredos | Auditoria sem vulnerabilidades conhecidas; verificação das alterações preparadas sem segredos detectados. |

**Ocorrência intermitente ainda sem causa confirmada:** a última execução conjunta registrada em `final-test-sandbox.log` terminou com código 1: backend inteiro aprovado, 25 testes de navegador aprovados e uma falha na criação inicial de ambiente pelo teste da API. A resposta HTTP dessa ocorrência não foi capturada. A asserção foi aprimorada para registrar status/corpo em futuras falhas, e os IDs passaram a distinguir repetições. Não houve mudança de produto nem retry automático para ocultar o resultado. O caso passou nas 12 repetições específicas e nas duas rodadas completas posteriores, sem reproduzir a falha. Portanto, as suítes possuem evidência de aprovação, mas aquele comando conjunto não é apresentado como aprovado e a intermitência permanece como risco registrado.

Nixpacks e Cloud Native Buildpacks são extensões futuras, fora dos builders implementados. Viewport móvel e bind LAN não equivalem a aceitação em aparelho físico. Não foi usado LLM pago/Telegram real, repositório privado autenticado, push remoto nem teste de carga prolongado/OOM do host. CPU/memória são verificadas como limites aplicados ao container; isto não é benchmark de capacidade. Estes limites não são apresentados como testes aprovados.

## Investigação complementar da falha da API — 23/09/2026

A falha histórica continua **sem causa confirmada e sem correção de produto atribuída a ela**. A investigação partiu do commit `07b6d54` em checkout isolado e examinou autenticação/origem, leitura do corpo HTTP, inicialização do runner, persistência e conflitos de revisão. Não há evidência suficiente para atribuir a ocorrência a concorrência, inicialização ou colisão de IDs.

- A suíte original de navegador passou novamente: 26/26.
- Quinze raízes novas, com dez instâncias independentes do cliente por raiz, completaram 150 criações concorrentes usando a inicialização automática do runner real, sem falha.
- Quatro fluxos paralelos repetiram 50 vezes a sequência de origem ausente, comando inválido, corpo grande, conteúdo não JSON, criação, atualização e edição vencida: 200 sequências, 1.400 requisições, todas com a resposta esperada. Essa execução junto da suíte existente terminou em 30/30 testes aprovados. Os testes de estresse eram sondas temporárias e não foram incorporados à suíte padrão.
- Um teste permanente agora cria 12 ambientes simultaneamente e disputa duas edições da mesma revisão: exige uma aprovação, uma rejeição por conflito e a persistência exata da edição vencedora. O teste original verifica também o conteúdo dos erros, para não aceitar qualquer HTTP 400 como prova de validação correta.

Foi confirmada e corrigida uma lacuna na coleta de evidências: `on-first-retry` não gravava trace na primeira falha local, pois o padrão local é zero retries; a limpeza removia os logs da fixture. Agora `retain-on-failure` preserva o trace desde a primeira falha e a fixture anexa o estado de saúde e os últimos 64 KiB dos logs disponíveis do runner antes da limpeza. Uma falha deliberada confirmou que o ZIP contém as requisições, o estado e o log; essa sonda foi removida após a verificação. Isso melhora o diagnóstico, sem ser apresentado como correção da falha intermitente.

Evidências locais desta investigação: `.harness/sandbox-api-investigation/cold-start.json`, `browser-before.log`, `browser-stress.log`, `diagnostic-probe.json` e `diagnostic-evidence/`. O código de saída 1 de `diagnostic-probe.log` é esperado e corresponde somente à falha deliberada usada para verificar os anexos.

A validação final das alterações permanentes passou em 27/27 testes de navegador, sem retries ou testes ignorados, com Docker habilitado (`browser-final.json`). Também passaram os dez checks agregados: lint, tipos, build, testes/cobertura, duplicação, código morto, tamanho, documentação da API, publicação e formato (`checks.json`). Essa rodada valida a instrumentação e a regressão de concorrência; a ocorrência histórica permanece aberta até existir evidência de sua causa.
