# Guia de operação: trabalhos de programação

Guia para quem administra uma instalação Oinko e quer que **qualquer bot** aceite trabalho de programação em segundo plano. Nada aqui depende de o bot se chamar Dev. [Voltar ao plano](README.md) · [Validação](VALIDATION.md) · [Blueprint](../../blueprint/27-programming-runs.md).

## 1. O que está disponível

| Capacidade | Estado |
| --- | --- |
| Run durável (fila por bot, ciclos, pausa/retomada/cancelamento, recuperação após reinício) | implementado e testado (unitário + Docker real) |
| Busca, leitura por intervalo, replace/patch com hash, diff e checks na sandbox | implementado e testado (unitário + Docker real) |
| Prévia, navegador isolado e verificação funcional ligada à revisão | implementado; navegador validado em Docker real no runner; fluxo completo pelo agente validado com ambiente simulado |
| Draft PR via GitHub App e acompanhamento do CI | implementado e testado com GitHub simulado; **App real pendente** |
| Contexto eficiente, fallback fast → principal (15 s) | implementado e testado com provedor simulado; **provedor real pendente** |
| Avaliação, candidatos, promoção e rollback | implementado e testado (simulado e Docker); **baseline com provedor real pendente** |
| Telegram | adaptador testado; **jornada real pendente** |

Pendências reais estão no [relatório de validação](validation-reports/) mais recente e nas próprias stories.

## 2. Pré-requisitos

- Node 22.5+ (usa `node:sqlite`), pnpm e Docker em execução para sandbox, prévias e navegador.
- `pnpm build:packages` feito; o runner local (`apps/environment-runner`) inicia sob demanda.
- Chave do provedor de modelo configurada no bot. Para o modelo rápido e a seleção progressiva de ferramentas, o **Jev** (TypeSafe) habilitado no bot.

## 3. Habilitar trabalhos em um bot

Dashboard → **Bots** → bot → **Configurar** → *Trabalhos de programação duráveis*. Pelo MCP Oinko: `oinko_update_bot` com `changes.programmingPolicy` (política completa) e a `revision` atual.

| Campo | Efeito |
| --- | --- |
| Autonomia | `analysis` (não altera projetos), `edit` (edita e valida) ou `draft_pr` (entrega em draft quando o projeto autoriza). |
| Modelo principal / rápido | Em branco usa o modelo do bot. O rápido exige Jev e precisa ser diferente do principal. |
| Fallback após | Segundos sem saída útil até trocar do rápido para o principal (padrão 15). Uma troca por chamada lógica; texto parcial e ferramentas já executadas são preservados. |
| Confiança mínima do Jev | Limiar para rotear um ciclo ao modelo rápido; em branco usa o do bot. |
| Carregar ferramentas sob demanda | O Jev escolhe as ferramentas do ciclo por um catálogo compacto; controles do trabalho ficam sempre disponíveis. Escolha nunca é autorização. Exige Jev. |
| Máximo de ferramentas carregadas | Limite da seleção; o agente busca outras com `ToolSearch` quando precisa. |
| Iterações por ciclo / ciclos sem progresso / tempo por comando | Limites técnicos. Três ciclos sem evidência nova bloqueiam o trabalho. |
| Retomar automaticamente | Após reinício, depois de reconciliar operações incertas e conferir permissões. |
| Browser / Publicar draft PR | Só valem em projetos que também os habilitem. |

Salvar recusa com mensagem verificável: modelo rápido igual ao principal, modelo sem *function calling* no endpoint, prefixo de provedor incompatível com o `baseUrl`, modelo rápido ou seleção sem Jev. **Não existe teto de gasto**; consumo é medido por trabalho. Reinicie o bot para aplicar.

## 4. Autorizar o bot em um projeto

Em **Projetos** → projeto:

- `allowedBotIds`: bots que podem trabalhar no projeto. Revogar vale na próxima operação, inclusive de um trabalho em andamento.
- **Comandos** (`repositório:caminho:tipo = comando`): vencem a detecção automática por manifest/`AGENTS.md`.
- **Browser**: habilitar, origens extras (`allowedOrigins`; nunca uma rede inteira), documentação pública e **nomes** das credenciais de teste. Os valores ficam no cofre do runner: `browserSaveCredential` (administrador), cifrados por projeto e nunca devolvidos.
- **GitHub**: `installationId`, repositórios (`owner`, `name`, `baseBranch`) e `publisherBotIds` (subconjunto dos permitidos que podem publicar).

## 5. GitHub App

Siga *Publicação no GitHub (GitHub App)* em [`packages/environments/README.md`](../../../packages/environments/README.md): App própria da instância, sem webhook, permissões mínimas (Contents e Pull requests RW, Checks e Commit statuses R), instalação só nos repositórios do projeto, chave enviada por `saveGithubApp`. Tokens são curtos, usados só pelo processo do runner e nunca entram na sandbox. Não há merge, aprovação, *ready for review*, deploy nem force push.

## 6. Pedir, acompanhar e orientar

- **Dashboard**: *Trabalhos* (fila de todos os bots) e *Bots → bot → Trabalhos*. O detalhe mostra plano, critérios com revisão, evidências (diff, logs, captura de tela, relatório funcional), PRs com estado do CI, consumo e linha do tempo.
- **Telegram/CLI**: `/tarefa [projeto] <pedido>`, `/analise [projeto] <pedido>`, `/status [id]`, `/pause [id]`, `/resume [id] [nota]`, `/cancel [id]`, `/orientar [id] <texto>`. Sem ID, vale o trabalho ativo da conversa; cada conversa só vê os próprios trabalhos.
- **MCP Oinko**: `oinko_run_start`, `oinko_runs`, `oinko_run`, `oinko_run_control`, `oinko_run_explain`, `oinko_artifact`. Com `--bot <id>` a conexão fica restrita àquele bot.
- A mensagem final lista verificações com o resultado real (*skipped* e falha de infraestrutura nunca aparecem como aprovados), fluxos funcionais, links dos draft PRs com o estado do CI do commit e pendências. Defina `OINKO_DASHBOARD_URL` para incluir o link do trabalho.

## 7. Controle seguro

- **Pausar**: fica *pausa solicitada* até o próximo ponto seguro (entre efeitos); nunca interrompe uma escrita pela metade.
- **Cancelar**: encerra processos controlados e preserva arquivos, commits e prévias; não faz reset nem limpeza.
- **Retomar**: um trabalho bloqueado exige nota explicando a decisão.
- **Orientar**: a orientação é persistida e aplicada no próximo ciclo.

## 8. Reinício e operação incerta

Ao reiniciar o worker, cada trabalho `running` com lease vencido é **reconciliado antes de continuar**: edições pelo journal do runner, checks pelo estado do job, prévias pelo job e publicações pelo remoto e pelos recibos do runner. O que não pode ser provado fica `uncertain` e bloqueia o trabalho; ele não conclui com operação incerta.

Para resolver:

1. Abra o trabalho na dashboard: a operação incerta mostra tipo, parâmetros resumidos e evidências.
2. Publicação: consulte `reconcilePublication` (ou repita a operação com o **mesmo** `operationId`): o runner consulta ramo remoto e PRs antes de qualquer novo efeito e nunca abre PR duplicado.
3. Edição/comando: confira a worktree e o diff; retome com uma nota que registre o que foi verificado.

## 9. Dados, logs, retenção e backup

| Caminho em `.harness/` | Conteúdo |
| --- | --- |
| `programming.db` | runs, passos, recibos, critérios, evidências, publicações, journal/outbox, avaliações |
| `programming-artifacts/`, `programming.key` | artefatos endereçados por conteúdo; chave dos links assinados |
| `publication.db`, `publication.key`, `publication/` | App (chave cifrada), recibos e espelhos Git do runner |
| `browser.key` | chave do cofre de credenciais de teste |
| `bots/<id>/telemetry.db` | telemetria do bot, incluindo eventos entregues dos trabalhos |
| `runtime/runner-process.log`, `runner-error.log` | logs do runner |
| `bots/<id>/worker.log` | saída do worker do bot: rejeições e exceções não tratadas, com os segredos do bot redigidos (rotaciona em 5 MB) |

- **Retenção**: `retentionDays` da telemetria do bot vale para eventos do journal e artefatos; trabalhos vivos e operações incertas não perdem evidência. Artefato expirado aparece como expirado, nunca some em silêncio.
- **Backup**: pare os workers e o runner; copie juntos `programming.db` (ou use o backup online `VACUUM INTO` de `ProgrammingDatabase.backup`), `programming-artifacts/`, `programming.key`, `publication.db` + `publication.key` e `browser.key`. Chaves nunca vão para o banco nem para containers; não as versione.
- **Restaurar**: com workers, runner e dashboard parados, restaure a cópia de `programming.db` com `restoreProgrammingBackup(backup, destino)` de `@oinko/agent-runtime/programming` (confere integridade e versão do esquema antes de substituir; um arquivo inválido não restaura nada) e devolva junto `programming-artifacts/` e as chaves do mesmo momento. Ao subir, trabalhos que estavam `running` são reconciliados como após um reinício (seção 8).
- **Atualizar e voltar o binário**: toda migration grava antes um backup em `.harness/backups/` (`programming-v<versão anterior>-<instante>.db`). As migrations deste plano são aditivas (v1 runs, v2 avaliação): um binário anterior continua abrindo o banco. Para voltar a um binário anterior a uma migration **não** aditiva, pare tudo e restaure o backup daquela versão; nunca edite o banco à mão.
- **Rotação**: chave da GitHub App via `saveGithubApp` (confirme com `githubAppStatus { verify: true }` antes de apagar a antiga). Trocar `programming.key` só invalida links de artefato já emitidos.

## 10. Avaliar e melhorar com controle

```bash
pnpm --filter @oinko/bots build
OINKO_ROOT=<instalação> pnpm --filter @oinko/bots evaluate --bot <id> --dataset packages/bots/evaluation/programming-baseline.v1.json
# candidato: --candidate <id>; provedor real: --environment real --runner apps/environment-runner/dist/main.js (3 repetições)
```

Cada tentativa roda numa raiz isolada, sem GitHub App e sem publicador; a CLI recusa raiz dentro da instalação. *Skipped* nunca conta como aprovado e custo desconhecido nunca vira zero. Em *Bots → bot → Avaliações*: comparar, **aprovar com motivo**, promover (mesma revisão do bot e ferramentas exigidas presentes), observar e reverter. Reverter lista os trabalhos afetados e não muda o snapshot de nenhum deles.

## 11. Validação da instalação

`pnpm validate:programming` roda gates agregados, suítes por pacote, Docker quando disponível, e2e da dashboard e o gate de IDs de piloto; grava `validation_suite_*` e um relatório em `docs/milestones/programming-agents/validation-reports/`. Provedor real, GitHub real, Telegram real e aceite humano aparecem como pendentes até serem executados de fato.

## 12. Solução de problemas

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| Bot não inicia: "Configure a chave da API" | chave do provedor ausente | cadastrar a chave no bot e reiniciar |
| Salvar política falha citando Jev, prefixo ou *function calling* | política de modelos incompatível | corrigir modelos ou habilitar o Jev (seção 3) |
| Publicação: `app_auth_failed`, `clock_skew`, `installation_*`, `master_key_missing` | App, relógio ou chave mestra | ver tabela de códigos no README de ambientes; `githubAppStatus { verify: true }` |
| Checks/prévia falham com infraestrutura, `sandbox_failed`, `docker_unavailable` | Docker parado ou sem recursos | iniciar o Docker; conferir `runner-error.log`; o trabalho não conta infraestrutura como aprovação |
| Navegador `browser_unavailable` (`sandbox_unavailable`, `image_pulling`…) | imagem baixando (~1 GB no primeiro uso) ou sandbox do Chromium indisponível | aguardar a imagem; a sandbox nunca é desligada em silêncio |
| Respostas lentas | modelo rápido parado | eventos `model_fallback_triggered` mostram a troca após 15 s; ajuste *Fallback após*; se o principal também falhar, o ciclo termina com erro e o trabalho continua no próximo |
| PR com resultado incerto | resposta perdida após push/criação | seção 8: reconciliar antes de repetir; o mesmo `operationId` nunca duplica |
| Trabalho bloqueado "sem progresso" | três ciclos sem evidência nova | ler o último erro no detalhe; orientar e retomar com nota |
| Trabalho "Na fila" que não anda | o worker do bot está parado (caiu ou não foi iniciado) | retomar pela dashboard inicia o worker e avisa se não conseguiu; veja `bots/<id>/worker.log` para saber por que ele caiu |
| Agente pergunta de novo o que você já respondeu | a resposta não chegou ao ciclo (versões antes de 25/09) | responda pela nota de **Retomar** ou por uma orientação: as duas chegam ao próximo ciclo junto com a pergunta, e a orientação a um run que espera resposta o retoma |
| Trabalho bloqueado `runner_outdated` ("versão anterior… não conhece a operação") | o runner em execução foi iniciado antes do último build e não conhece os comandos novos (`/health` lista os que ele atende) | pausar os trabalhos ativos, encerrar o processo do runner (`ps` mostra `apps/environment-runner/dist/main.js`; containers e worktrees continuam), deixar a próxima operação subir o runner atual e retomar com nota. Depois de `pnpm build:packages`, reinicie também dashboard e workers |

## 13. Limites conhecidos

- Capturas de tela mascaram campos preenchidos com credencial, mas não redigem pixels de conteúdo exibido pela aplicação.
- Sessões de navegador compartilham o processo principal do Chromium (renderers isolados pela sandbox).
- Proxy do navegador em Linux (gateway da rede `bridge`) ainda não validado; testado em Docker Desktop no macOS.
- Mudanças feitas fora do trabalho (na worktree ou na configuração do ambiente) são detectadas pela sonda de revisões ao fim de cada ciclo; entre dois ciclos, uma mudança ainda não observada não invalida nada.
- O harness não provisiona ambiente de prévia real: casos visuais em Docker/provedor real ficam *não executados*.
- Evidências das tentativas de avaliação ficam na raiz isolada e são apagadas ao fim, salvo `--keep`.
