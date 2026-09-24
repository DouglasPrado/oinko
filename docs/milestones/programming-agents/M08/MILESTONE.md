# M08 — Avaliação e melhoria controlada

**Status:** in_progress — 3 de 4 stories concluídas; em aberto: M08-S01. Pendências reais e de aceite humano em cada story.

[Índice do plano](../README.md) · [Requisitos](../REQUIREMENTS.md)

## Objetivo

Usar telemetria para descobrir gargalos, testar mudanças e promover versões com evidência.

## Entrada

Dependências externas: [M00-S03](../M00/M00-S03.md), [M01-S03](../M01/M01-S03.md), [M01-S05](../M01/M01-S05.md), [M03-S06](../M03/M03-S06.md), [M05-S04](../M05/M05-S04.md), [M06-S04](../M06/M06-S04.md), [M07-S04](../M07/M07-S04.md).

## Stories e ordem

| Story | Entrega | Status | Depende de |
| --- | --- | --- | --- |
| [M08-S01](M08-S01.md) | Construir dataset e harness de avaliação | in_progress | M00-S03, M01-S03, M03-S06 |
| [M08-S02](M08-S02.md) | Diagnosticar gargalos a partir da telemetria | completed | M08-S01, M07-S04, M06-S04, M05-S04 |
| [M08-S03](M08-S03.md) | Versionar candidatos e promover com rollback | completed | M08-S02 |
| [M08-S04](M08-S04.md) | Operar relatórios e auditoria do ciclo de melhoria | completed | M08-S03, M01-S05 |

## Gate de saída

Comparações reproduzíveis não confundem redução de custo com qualidade; toda promoção tem versão, aprovação e rollback.

- Todas as stories deste milestone têm critérios atendidos e evidências registradas.
- Telemetria profunda é validada em sucesso, erro, negativa de permissão e recuperação aplicáveis.
- Configuração por bot/projeto e isolamento não dependem do piloto Dev.
- Testes não executados permanecem pendentes; aceites reais são registrados separadamente.

## Entrega incremental

Um ou mais PRs pequenos por capacidade, respeitando dependências das stories. Não agrupar mudanças alheias do redesign. O milestone não é um PR obrigatório único. Atualizar blueprint, contratos, MAPPING e guias junto da implementação.

## Evidências e aceite

Pendente. Registrar links de PR, revisão, relatório de validação, traces e aceite do operador quando exigido.
