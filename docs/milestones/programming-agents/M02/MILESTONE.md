# M02 — Entendimento do projeto e edição precisa

**Status:** in_progress — todas as 5 stories concluídas com evidência; falta o aceite do operador sobre o gate de saída (`milestone_accepted`).

[Índice do plano](../README.md) · [Requisitos](../REQUIREMENTS.md)

## Objetivo

Permitir descobrir, ler e alterar código dentro da worktree com pouco contexto e controle de concorrência.

## Entrada

Dependências externas: [M00-S02](../M00/M00-S02.md), [M01-S02](../M01/M01-S02.md).

## Stories e ordem

| Story | Entrega | Status | Depende de |
| --- | --- | --- | --- |
| [M02-S01](M02-S01.md) | Buscar caminhos e conteúdo na worktree | completed | M00-S02, M01-S02 |
| [M02-S02](M02-S02.md) | Ler intervalos com versão de conteúdo | completed | M02-S01 |
| [M02-S03](M02-S03.md) | Substituição exata e patch com validação prévia | completed | M02-S02, M01-S02 |
| [M02-S04](M02-S04.md) | Carregar instruções e descobrir comandos de monorepo | completed | M02-S01, M02-S02 |
| [M02-S05](M02-S05.md) | Revisar diff e executar verificações pertinentes | completed | M02-S03, M02-S04 |

## Gate de saída

Busca e edição funcionam em monorepo real, preservam alterações existentes e não escapam da sandbox.

- Todas as stories deste milestone têm critérios atendidos e evidências registradas.
- Telemetria profunda é validada em sucesso, erro, negativa de permissão e recuperação aplicáveis.
- Configuração por bot/projeto e isolamento não dependem do piloto Dev.
- Testes não executados permanecem pendentes; aceites reais são registrados separadamente.

## Entrega incremental

Um ou mais PRs pequenos por capacidade, respeitando dependências das stories. Não agrupar mudanças alheias do redesign. O milestone não é um PR obrigatório único. Atualizar blueprint, contratos, MAPPING e guias junto da implementação.

## Evidências e aceite

Pendente. Registrar links de PR, revisão, relatório de validação, traces e aceite do operador quando exigido.
