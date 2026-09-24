# M01 — Telemetria profunda desde a fundação

**Status:** in_progress — todas as 5 stories concluídas com evidência; falta o aceite do operador sobre o gate de saída (`milestone_accepted`).

[Índice do plano](../README.md) · [Requisitos](../REQUIREMENTS.md)

## Objetivo

Rastrear a execução inteira com persistência, privacidade e custo corretamente atribuído.

## Entrada

Dependências externas: [M00-S01](../M00/M00-S01.md), [M00-S02](../M00/M00-S02.md), [M00-S04](../M00/M00-S04.md).

## Stories e ordem

| Story | Entrega | Status | Depende de |
| --- | --- | --- | --- |
| [M01-S01](M01-S01.md) | Envelope, spans e catálogo versionado de eventos | completed | M00-S01, M00-S02 |
| [M01-S02](M01-S02.md) | Persistir eventos, recibos e recuperar entregas interrompidas | completed | M01-S01, M00-S04 |
| [M01-S03](M01-S03.md) | Captura segura, acesso e ciclo de vida de artefatos | completed | M01-S01, M01-S02 |
| [M01-S04](M01-S04.md) | Contabilizar tokens, custo e tempos por run | completed | M01-S01, M01-S02 |
| [M01-S05](M01-S05.md) | Explorar uma execução na telemetria | completed | M01-S03, M01-S04 |

## Gate de saída

Toda operação de teste possui correlação, início, término ou resultado incerto explícito; segredos ausentes e contabilidade sem duplicações.

- Todas as stories deste milestone têm critérios atendidos e evidências registradas.
- Telemetria profunda é validada em sucesso, erro, negativa de permissão e recuperação aplicáveis.
- Configuração por bot/projeto e isolamento não dependem do piloto Dev.
- Testes não executados permanecem pendentes; aceites reais são registrados separadamente.

## Entrega incremental

Um ou mais PRs pequenos por capacidade, respeitando dependências das stories. Não agrupar mudanças alheias do redesign. O milestone não é um PR obrigatório único. Atualizar blueprint, contratos, MAPPING e guias junto da implementação.

## Evidências e aceite

Pendente. Registrar links de PR, revisão, relatório de validação, traces e aceite do operador quando exigido.
