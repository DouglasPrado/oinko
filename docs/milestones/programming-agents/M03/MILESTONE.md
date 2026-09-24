# M03 — Execução durável e controle do trabalho

**Status:** in_progress — todas as 6 stories concluídas com evidência; falta o aceite do operador sobre o gate de saída (`milestone_accepted`).

[Índice do plano](../README.md) · [Requisitos](../REQUIREMENTS.md)

## Objetivo

Fazer tarefas longas continuarem com progresso persistido, fila e reconciliação de efeitos.

## Entrada

Dependências externas: [M00-S04](../M00/M00-S04.md), [M01-S02](../M01/M01-S02.md), [M02-S05](../M02/M02-S05.md).

## Stories e ordem

| Story | Entrega | Status | Depende de |
| --- | --- | --- | --- |
| [M03-S01](M03-S01.md) | Persistir runs, passos e recibos | completed | M00-S04, M01-S02 |
| [M03-S02](M03-S02.md) | Despachar em segundo plano e ordenar fila por bot | completed | M03-S01 |
| [M03-S03](M03-S03.md) | Continuar ciclos e detectar ausência de progresso | completed | M03-S02, M02-S05 |
| [M03-S04](M03-S04.md) | Recuperar após restart sem repetir efeitos incertos | completed | M03-S01, M03-S02, M03-S03 |
| [M03-S05](M03-S05.md) | Pausar, retomar e cancelar com semântica segura | completed | M03-S02, M03-S04 |
| [M03-S06](M03-S06.md) | Persistir orientação do usuário e critérios de entrega | completed | M03-S03, M03-S05 |

## Gate de saída

Restart, cancelamento e concorrência não perdem estado nem repetem efeitos externos; comandos de controle permanecem responsivos.

- Todas as stories deste milestone têm critérios atendidos e evidências registradas.
- Telemetria profunda é validada em sucesso, erro, negativa de permissão e recuperação aplicáveis.
- Configuração por bot/projeto e isolamento não dependem do piloto Dev.
- Testes não executados permanecem pendentes; aceites reais são registrados separadamente.

## Entrega incremental

Um ou mais PRs pequenos por capacidade, respeitando dependências das stories. Não agrupar mudanças alheias do redesign. O milestone não é um PR obrigatório único. Atualizar blueprint, contratos, MAPPING e guias junto da implementação.

## Evidências e aceite

Pendente. Registrar links de PR, revisão, relatório de validação, traces e aceite do operador quando exigido.
