# M04 — Operação pela dashboard, Telegram e MCP

**Status:** in_progress — 2 de 4 stories concluídas; em aberto: M04-S02, M04-S03. Pendências reais e de aceite humano em cada story.

[Índice do plano](../README.md) · [Requisitos](../REQUIREMENTS.md)

## Objetivo

Disponibilizar o mesmo ciclo de trabalho em qualquer interface e bot autorizado.

## Entrada

Dependências externas: [M00-S02](../M00/M00-S02.md), [M01-S05](../M01/M01-S05.md), [M03-S01](../M03/M03-S01.md), [M03-S05](../M03/M03-S05.md), [M03-S06](../M03/M03-S06.md).

## Stories e ordem

| Story | Entrega | Status | Depende de |
| --- | --- | --- | --- |
| [M04-S01](M04-S01.md) | Configurar capacidades e políticas na dashboard | completed | M00-S02, M03-S01 |
| [M04-S02](M04-S02.md) | Acompanhar trabalhos e evidências na dashboard | in_progress | M03-S05, M03-S06, M01-S05 |
| [M04-S03](M04-S03.md) | Operar tarefas pelo Telegram e CLI | in_progress | M03-S05, M03-S06 |
| [M04-S04](M04-S04.md) | Expor controle e consulta no MCP Oinko | completed | M03-S05, M03-S06, M04-S01, M01-S05 |

## Gate de saída

Mesma tarefa pode ser acompanhada e controlada por todas as interfaces, com permissões equivalentes e sem ferramentas duplicadas.

- Todas as stories deste milestone têm critérios atendidos e evidências registradas.
- Telemetria profunda é validada em sucesso, erro, negativa de permissão e recuperação aplicáveis.
- Configuração por bot/projeto e isolamento não dependem do piloto Dev.
- Testes não executados permanecem pendentes; aceites reais são registrados separadamente.

## Entrega incremental

Um ou mais PRs pequenos por capacidade, respeitando dependências das stories. Não agrupar mudanças alheias do redesign. O milestone não é um PR obrigatório único. Atualizar blueprint, contratos, MAPPING e guias junto da implementação.

## Evidências e aceite

Pendente. Registrar links de PR, revisão, relatório de validação, traces e aceite do operador quando exigido.
