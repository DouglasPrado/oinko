# M09 — Validação integrada e adoção gradual

**Status:** in_progress — 1 de 4 stories concluídas; em aberto: M09-S02, M09-S03, M09-S04 (bloqueada: M09-S02). Pendências reais e de aceite humano em cada story.

[Índice do plano](../README.md) · [Requisitos](../REQUIREMENTS.md)

## Objetivo

Comprovar desenvolvimento eficiente em ambiente real e reuso entre bots antes da adoção ampla.

## Entrada

Dependências externas: [M02-S05](../M02/M02-S05.md), [M03-S06](../M03/M03-S06.md), [M04-S04](../M04/M04-S04.md), [M05-S04](../M05/M05-S04.md), [M06-S04](../M06/M06-S04.md), [M07-S04](../M07/M07-S04.md), [M08-S01](../M08/M08-S01.md), [M08-S04](../M08/M08-S04.md).

## Stories e ordem

| Story | Entrega | Status | Depende de |
| --- | --- | --- | --- |
| [M09-S01](M09-S01.md) | Executar bateria determinística e falhas injetadas | completed | M02-S05, M03-S06, M04-S04, M05-S04, M06-S04, M07-S04 |
| [M09-S02](M09-S02.md) | Comparar quatro tarefas reais com baseline | blocked | M09-S01, M08-S01 |
| [M09-S03](M09-S03.md) | Provar reuso com dois bots e rollout piloto | in_progress | M09-S02, M08-S04 |
| [M09-S04](M09-S04.md) | Publicar guia operacional e encerrar com evidências | in_progress | M09-S03 |

## Gate de saída

Cenários reais aprovados com evidência, sem efeitos duplicados, isolamento comprovado e procedimento operacional publicado.

- Todas as stories deste milestone têm critérios atendidos e evidências registradas.
- Telemetria profunda é validada em sucesso, erro, negativa de permissão e recuperação aplicáveis.
- Configuração por bot/projeto e isolamento não dependem do piloto Dev.
- Testes não executados permanecem pendentes; aceites reais são registrados separadamente.

## Entrega incremental

Um ou mais PRs pequenos por capacidade, respeitando dependências das stories. Não agrupar mudanças alheias do redesign. O milestone não é um PR obrigatório único. Atualizar blueprint, contratos, MAPPING e guias junto da implementação.

## Evidências e aceite

Pendente. Registrar links de PR, revisão, relatório de validação, traces e aceite do operador quando exigido.
