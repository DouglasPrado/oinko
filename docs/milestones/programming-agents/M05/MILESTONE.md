# M05 — Browser isolado e validação funcional

**Status:** pending

[Índice do plano](../README.md) · [Requisitos](../REQUIREMENTS.md)

## Objetivo

Permitir que qualquer bot teste prévias e consulte documentação com evidência reproduzível.

## Entrada

Dependências externas: [M00-S02](../M00/M00-S02.md), [M01-S03](../M01/M01-S03.md), [M02-S05](../M02/M02-S05.md), [M03-S01](../M03/M03-S01.md), [M03-S06](../M03/M03-S06.md), [M04-S04](../M04/M04-S04.md).

## Stories e ordem

| Story | Entrega | Status | Depende de |
| --- | --- | --- | --- |
| [M05-S01](M05-S01.md) | Provisionar browser isolado por execução | pending | M00-S02, M01-S03, M03-S01 |
| [M05-S02](M05-S02.md) | Navegar com políticas de rede e login de teste | pending | M05-S01 |
| [M05-S03](M05-S03.md) | Expor ações, leitura e diagnóstico de browser | pending | M05-S02, M04-S04 |
| [M05-S04](M05-S04.md) | Vincular preview e verificação funcional à revisão | pending | M05-S03, M02-S05, M03-S06 |

## Gate de saída

Fluxos reais de browser comprovam revisão testada, isolamento de sessões e diagnóstico de erros.

- Todas as stories deste milestone têm critérios atendidos e evidências registradas.
- Telemetria profunda é validada em sucesso, erro, negativa de permissão e recuperação aplicáveis.
- Configuração por bot/projeto e isolamento não dependem do piloto Dev.
- Testes não executados permanecem pendentes; aceites reais são registrados separadamente.

## Entrega incremental

Um ou mais PRs pequenos por capacidade, respeitando dependências das stories. Não agrupar mudanças alheias do redesign. O milestone não é um PR obrigatório único. Atualizar blueprint, contratos, MAPPING e guias junto da implementação.

## Evidências e aceite

Pendente. Registrar links de PR, revisão, relatório de validação, traces e aceite do operador quando exigido.
