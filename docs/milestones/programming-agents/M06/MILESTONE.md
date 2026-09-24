# M06 — GitHub App e entrega automática em draft

**Status:** in_progress — 1 de 4 stories concluídas; em aberto: M06-S01, M06-S03, M06-S04. Pendências reais e de aceite humano em cada story.

[Índice do plano](../README.md) · [Requisitos](../REQUIREMENTS.md)

## Objetivo

Publicar trabalho validado com credenciais limitadas e reconciliação de efeitos externos.

## Entrada

Dependências externas: [M00-S02](../M00/M00-S02.md), [M01-S03](../M01/M01-S03.md), [M01-S05](../M01/M01-S05.md), [M02-S05](../M02/M02-S05.md), [M03-S01](../M03/M03-S01.md), [M03-S04](../M03/M03-S04.md), [M04-S01](../M04/M04-S01.md).

## Stories e ordem

| Story | Entrega | Status | Depende de |
| --- | --- | --- | --- |
| [M06-S01](M06-S01.md) | Conectar GitHub App e instalações por projeto | in_progress | M00-S02, M01-S03, M04-S01 |
| [M06-S02](M06-S02.md) | Isolar publicação autenticada e revisar conteúdo | completed | M06-S01, M02-S05, M03-S01 |
| [M06-S03](M06-S03.md) | Criar ou atualizar draft PR sem duplicação | in_progress | M06-S02, M03-S04 |
| [M06-S04](M06-S04.md) | Acompanhar CI e estados externos | in_progress | M06-S03, M01-S05 |

## Gate de saída

Repo de teste recebe exatamente um draft PR por identidade de trabalho; tokens e permissões ficam isolados do código executado.

- Todas as stories deste milestone têm critérios atendidos e evidências registradas.
- Telemetria profunda é validada em sucesso, erro, negativa de permissão e recuperação aplicáveis.
- Configuração por bot/projeto e isolamento não dependem do piloto Dev.
- Testes não executados permanecem pendentes; aceites reais são registrados separadamente.

## Entrega incremental

Um ou mais PRs pequenos por capacidade, respeitando dependências das stories. Não agrupar mudanças alheias do redesign. O milestone não é um PR obrigatório único. Atualizar blueprint, contratos, MAPPING e guias junto da implementação.

## Evidências e aceite

Pendente. Registrar links de PR, revisão, relatório de validação, traces e aceite do operador quando exigido.
