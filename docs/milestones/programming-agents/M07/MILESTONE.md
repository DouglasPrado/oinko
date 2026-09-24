# M07 — Contexto eficiente e fallback de modelo

**Status:** in_progress — 1 de 4 stories concluídas; em aberto: M07-S01, M07-S03, M07-S04. Pendências reais e de aceite humano em cada story.

[Índice do plano](../README.md) · [Requisitos](../REQUIREMENTS.md)

## Objetivo

Reduzir carregamento e espera sem perder continuidade, rastreabilidade ou qualidade.

## Entrada

Dependências externas: [M01-S04](../M01/M01-S04.md), [M01-S05](../M01/M01-S05.md), [M02-S04](../M02/M02-S04.md), [M03-S01](../M03/M03-S01.md), [M04-S01](../M04/M04-S01.md), [M04-S04](../M04/M04-S04.md).

## Stories e ordem

| Story | Entrega | Status | Depende de |
| --- | --- | --- | --- |
| [M07-S01](M07-S01.md) | Resumir histórico em segundo plano com consistência | in_progress | M01-S04, M03-S01 |
| [M07-S02](M07-S02.md) | Selecionar contexto e ferramentas progressivamente | completed | M07-S01, M02-S04, M04-S04 |
| [M07-S03](M07-S03.md) | Aplicar fallback por indisponibilidade e latência | in_progress | M07-S02, M01-S04 |
| [M07-S04](M07-S04.md) | Configurar e comparar eficiência por bot | in_progress | M07-S03, M04-S01, M01-S05 |

## Gate de saída

Contexto e ferramentas selecionados por necessidade; fallback sem duplicar ações e consumo integralmente visível.

- Todas as stories deste milestone têm critérios atendidos e evidências registradas.
- Telemetria profunda é validada em sucesso, erro, negativa de permissão e recuperação aplicáveis.
- Configuração por bot/projeto e isolamento não dependem do piloto Dev.
- Testes não executados permanecem pendentes; aceites reais são registrados separadamente.

## Entrega incremental

Um ou mais PRs pequenos por capacidade, respeitando dependências das stories. Não agrupar mudanças alheias do redesign. O milestone não é um PR obrigatório único. Atualizar blueprint, contratos, MAPPING e guias junto da implementação.

## Evidências e aceite

Pendente. Registrar links de PR, revisão, relatório de validação, traces e aceite do operador quando exigido.
