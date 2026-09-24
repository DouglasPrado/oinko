# Estado atual e linha de base a medir

**Data da inspeção:** 23/09/2026. [Voltar ao plano](README.md).

## Fundação existente

- Monorepo separa SDK, bots, runtime, canais, workspaces, ambientes, runner, MCP e dashboard.
- Há projetos/repositórios, worktrees por tarefa, sandbox e previews; ferramentas de status, tarefa, shell, leitura/escrita, preview e logs.
- Existem contexto adaptativo, checkpoints/resumos, recuperação limitada de resultados/histórico, seleção de ferramentas e roteamento Jev.
- Telemetria atual registra chamadas LLM/tools/MCP, decisões, payload conforme política e uso, incluindo estados de custo conhecido/indisponível.
- SDK possui ferramentas genéricas opcionais; isso não implica que estejam registradas no bot ou executem dentro da sandbox. Reusar contratos e comportamento sem dar acesso ao filesystem do host.

## Lacunas que este plano endereça

As ferramentas atuais do bot leem/escrevem arquivo inteiro, não oferecem todo o contrato de busca/range/patch planejado. O runtime de conversa não equivale a um ProgrammingRun durável. Browser isolado, recuperação ampla de efeitos, GitHub App/publicação isolada e ciclo de melhoria controlada precisam de entregas próprias. Telemetria de chamadas existente não comprova rastreamento completo de todo o processo de desenvolvimento.

O limite de iterações do loop SDK é por execução atual; a evolução deve criar ciclos duráveis, sem simplesmente tornar o loop ilimitado. Fallback já existente para alguns erros no SDK não comprova fallback por latência configurado no bot.

## Referências do repositório

- [Arquitetura de ambientes e workspaces](../../blueprint/24-workspaces-environments.md).
- [MCP Oinko](../../blueprint/25-oinko-mcp.md).
- [Contexto adaptativo](../../blueprint/26-adaptive-context.md).
- [Observabilidade](../../blueprint/15-observability.md).
- [Plano da dashboard](../../dashboard/PLAN.md).
- [Avaliação histórica de contexto](../../dashboard/CONTEXT-EVALUATION.md).
- [Validação de sandbox](../../dashboard/SANDBOX-E2E.md).

Os resultados antigos de economia de contexto não medem qualidade de programação de ponta a ponta. Bateria com LLM simulado e teste Docker real validam aspectos diferentes. M00-S03 deve capturar um baseline novo, e M09 deve comparar os mesmos cenários.

## Estado Git observado

Checkout inspecionado: `feat/harness-inteligencia`, HEAD `b28fee88a15157a3496279b835b9554917704922`, com alterações preexistentes da dashboard. Os [PRs 5](https://github.com/DouglasPrado/oinko/pull/5) e [6](https://github.com/DouglasPrado/oinko/pull/6) foram consultados e ambos estavam `MERGED`. Isso não prova que todo checkout local esteja atualizado. Revalidar branch/base antes de qualquer implementação.

## Linha de base medida (M00-S03)

Dataset congelado [`packages/bots/evaluation/programming-baseline.v1.json`](../../../packages/bots/evaluation/programming-baseline.v1.json), versão `programming-baseline@9685e5bf8356a2ea`: bug com teste (`bug-sum`), funcionalidade em monorepo com instruções por pacote (`monorepo-slugify`), alteração visual validada na prévia (`visual-selo`) e trabalho longo com reinício de processo após o 1º ciclo (`long-interrupted`). Cada caso define critérios verificáveis por evidência e artefatos esperados antes da execução; a fixture é commitada com autor e data fixos (mesmos arquivos → mesmo commit).

Comando: `OINKO_ROOT=<raiz> pnpm --filter @oinko/bots evaluate --bot <id> --dataset packages/bots/evaluation/programming-baseline.v1.json [--environment simulated|docker|real]`. Revisão da plataforma: `e7c4547` (branch `feat/programming-agents`), 24/09/2026, Node v26.8.1.

| Ambiente | Provedor | Workspace | Casos × repetições | Resultado | Tokens | Custo | Duração (mediana / p90) | Reinícios |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| simulado | modelo determinístico do caso | local simulado (sem isolamento) | 4 × 1 | 4 aprovados (100%) | 4180 (1045 por concluída) | **desconhecido** — 39 chamadas sem custo informado (nunca contado como zero) | 345 ms / 536 ms | 1 |
| Docker | modelo determinístico do caso | runner real + sandbox Docker | 4 × 1 | 3 aprovados; `visual-selo` **não executado** (sem ambiente de prévia real no harness) | — | desconhecido | — | 1 |
| provedor real | — | — | 4 × 3 | **não executado**: 12 tentativas *skipped* (`real_provider_unavailable`) | — | — | — | — |

Leitura honesta:

- A linha simulada mede o **harness e a plataforma** (ferramentas, critérios, recuperação), não a qualidade de um modelo: o "modelo" é o roteiro do caso. Serve para regressão e para comparar políticas que mudam o fluxo (por exemplo, iterações por ciclo), não para prometer economia.
- Tokens vêm do uso informado pelo provedor simulado; o custo fica desconhecido porque nada foi cobrado nem informado.
- A baseline de qualidade de programação exige provedor real com três repetições por caso (M09-S02); ela **ainda não foi executada** por falta de credencial de avaliação nesta sessão. Os números antigos de `docs/dashboard/CONTEXT-EVALUATION.md` continuam referência histórica, não baseline deste plano.

## Evidência ainda necessária

Na escrita do plano (23/09/2026) nada estava implementado. O estado de cada story, com implementação, testes e pendências reais, está registrado na própria story e no [relatório de validação](reports/) mais recente. Continuam pendentes: baseline e comparação com provedor real (3 repetições), GitHub App real, jornada Telegram real e aceite humano do operador.
