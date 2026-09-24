# M00 — Contratos compartilhados e linha de base

**Status:** in_progress — 3 de 4 stories concluídas; em aberto: M00-S03. Pendências reais e de aceite humano em cada story.

[Índice do plano](../README.md) · [Requisitos](../REQUIREMENTS.md)

## Objetivo

Fixar arquitetura, políticas e critérios antes de alterar o comportamento dos bots.

## Entrada

Decisões do usuário consolidadas; baseline ainda não executado.

## Stories e ordem

| Story | Entrega | Status | Depende de |
| --- | --- | --- | --- |
| [M00-S01](M00-S01.md) | Modelar capacidade de programação e ProgrammingRun | completed | — |
| [M00-S02](M00-S02.md) | Definir políticas por bot, projeto e execução | completed | M00-S01 |
| [M00-S03](M00-S03.md) | Congelar cenários e medir baseline | in_progress | M00-S01, M00-S02 |
| [M00-S04](M00-S04.md) | Planejar migração e evolução compatível | completed | M00-S01, M00-S02 |

## Gate de saída

Contratos revisados, fixtures reproduzíveis e linha de base registrada; nenhum resultado histórico contado como aceite deste plano.

- Todas as stories deste milestone têm critérios atendidos e evidências registradas.
- Telemetria profunda é validada em sucesso, erro, negativa de permissão e recuperação aplicáveis.
- Configuração por bot/projeto e isolamento não dependem do piloto Dev.
- Testes não executados permanecem pendentes; aceites reais são registrados separadamente.

## Entrega incremental

Um ou mais PRs pequenos por capacidade, respeitando dependências das stories. Não agrupar mudanças alheias do redesign. O milestone não é um PR obrigatório único. Atualizar blueprint, contratos, MAPPING e guias junto da implementação.

## Evidências e aceite

Pendente. Registrar links de PR, revisão, relatório de validação, traces e aceite do operador quando exigido.
