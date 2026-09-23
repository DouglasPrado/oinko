# Projetos, ambientes e prévias locais

Status: implementado e verificado localmente em 2026-09-22. Evidências por requisito e limites de validação em [ENVIRONMENTS-DELIVERY.md](../dashboard/ENVIRONMENTS-DELIVERY.md).

## Resultado solicitado

A dashboard cadastra projetos Git (incluindo monorepos e conjuntos de repositórios relacionados), configura o ambiente de programação do bot e sobe a aplicação a partir de uma worktree escolhida. Um novo bot reutiliza projetos autorizados. Docker executa o ambiente; Compose organiza serviços; Traefik fornece acesso às prévias. Dockerfile, Railpack e imagem pronta são os builders iniciais. Nixpacks e Cloud Native Buildpacks são extensões futuras do mesmo contrato, sem alegação de suporte já entregue.

## Modelo e responsabilidades

- Project: nome, repositórios Git, ambientes vinculados e bots autorizados. Pode ser criado antes dos ambientes. O primeiro ambiente torna-se o padrão das ferramentas do sandbox (`environmentId`); configurações adicionais vivem em `environmentIds`. Dados antigos continuam válidos. A mesma definição pode ser reutilizada deliberadamente.
- Repository: origem Git e referência inicial. Cada clone gerenciado permanece no workspace do projeto, separado do checkout original.
- Task: trabalho associado ao projeto e a uma branch/worktree em cada repositório envolvido.
- Environment: ferramentas do container de programação, CPU/memória/rede e serviços da aplicação.
- Service: origem do código, contexto de build, builder, comandos, porta, verificação de disponibilidade, variáveis e dependências.
- Preview: instância dos serviços para uma Task. Uma prévia ativa por ambiente no projeto por padrão; concorrência configurável, com recursos nomeados por prévia.
- Job: operação persistida, com progresso, resultado, falha e logs limitados. Reinício do gerenciador reconcilia operações e containers existentes.

`packages/workspaces` contém cadastro, tarefas, worktrees e persistência. `packages/environments` contém contratos, cliente, políticas, sandbox Docker, builders, Compose e Traefik. `apps/environment-runner` hospeda o serviço local independente. Dashboard e bots usam seu cliente. O SDK de IA continua independente de Docker.

## Invariantes

1. O runner é o único controlador de Docker. Containers de bots e aplicações não recebem socket Docker, diretório pessoal nem cadastro/chaves do Oinko.
2. Leituras/escritas de código e comandos do bot passam pelo sandbox autorizado. Git e worktrees compartilham apenas os metadados do projeto.
3. Identificadores, referências e caminhos são validados. Contextos, Dockerfiles e bind mounts ficam no workspace selecionado; symlinks não permitem escapar.
4. Compose importado é validado antes de executar. Recursos privilegiados, mounts externos, sockets e redes do host são recusados. Configuração gerada pertence ao runner.
5. Segredos são cifrados no cadastro, campos de escrita na API, mascarados nos logs do gerenciador e não incorporados em labels/imagens por configuração automática.
6. Dashboard exige sessão e mesma origem nas mutações. Socket do runner é local e restrito ao usuário. Ferramentas de bot verificam autorização por projeto.
7. Cada prévia possui nomes, rede e volumes próprios. Parar não remove worktrees ou dados. Trocar worktree recria os serviços adequados.
8. Development monta código e permite hot reload; image constrói uma versão do código e exige rebuild para atualizar. A interface distingue os modos.
9. Traefik publica apenas serviços explicitamente selecionados. O acesso por celular usa endereço/IP alcançável na LAN, e não presume que localhost do celular aponta para o Mac.
10. Operações longas sobrevivem ao fechamento/reinício da dashboard e informam falhas reais, sem converter mocks ou testes unitários em aceitação do runtime.

## Aceitação e evidências exigidas

- Cadastro/edit de projetos, múltiplos repositórios, ambientes, serviços, permissões e segredos pela dashboard; persistência e conflitos de revisão testados.
- Clone e criação/listagem de tarefas/worktrees reais, sem alterar o checkout original; monorepo e pacotes compartilhados preservados.
- Bot programador pode listar projetos autorizados, criar tarefa, ler/escrever código, executar Git/testes dentro do Docker e solicitar prévias; projeto não autorizado é recusado.
- Builds reais por Dockerfile e Railpack; serviço de imagem pronta; Compose validado com dependências e variáveis.
- Prévia real via Traefik, seleção/troca de worktree, logs, estado disponível, reinício, parada, dados preservados e duas prévias sem conflito quando habilitadas.
- Falhas de build, timeout, recursos indisponíveis e reinício do runner aparecem corretamente.
- Navegador desktop e viewport móvel: criar/configurar/provisionar/testar/parar; autenticação e autorização verificadas.
- Checks agregados existentes e novos testes passam; instruções operacionais e limitações registradas, com evidência de runtime em documento de entrega.

## Ordem de execução

Contratos e testes; persistência; sandbox/Git; builders/Compose/Traefik; runner/cliente; ferramentas dos bots; dashboard; validação real e documentação. Esta ordem não reduz o escopo de aceitação.

## Navegação por contexto

`/projetos` → `/projetos/[projectId]` → `/projetos/[projectId]/ambientes/[environmentId]`. O projeto reúne ambientes, worktrees, repositórios/bots e atividade. O ambiente reúne prévias e serviços. Abas persistem na URL; detalhes, configurações, saída e terminal abrem sem trocar de projeto. Rotas antigas `/ambientes` e `/previas` redirecionam para Projetos.

O sandbox e as worktrees continuam isolados por projeto. `startPreview` aceita um `environmentId` opcional; o padrão permanece compatível com clientes anteriores. O runner valida o vínculo antes de enfileirar. Uma mesma worktree pode gerar prévias distintas em ambientes diferentes, com IDs, Compose, rotas e limites de concorrência independentes. O estado destinado aos bots expõe apenas ambientes vinculados a projetos autorizados.
