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

## Evidência ainda necessária

Todos os milestones e stories deste backlog começam `pending`. Não houve execução do novo baseline nem implementação das melhorias na escrita deste plano. As referências acima dão contexto de partida; os campos de evidência das stories serão preenchidos durante a construção.
