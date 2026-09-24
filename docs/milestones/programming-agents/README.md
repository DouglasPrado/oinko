# Plano de desenvolvimento autônomo reutilizável

**Status do plano:** in_progress — implementado e validado por testes automatizados, Docker real e e2e da dashboard; 29 de 44 stories concluídas com evidência. Pendentes: provedor real (baseline e comparação com 3 repetições), GitHub App real, jornada Telegram real e aceite do operador. Ver [relatório de validação](validation-reports/validation-9c3d44fb133d.md) e [guia de operação](RUNBOOK.md).
**Data:** 23/09/2026. **Escopo:** plataforma Oinko, disponível a qualquer bot autorizado.

Transformar os recursos existentes de sandbox, worktrees, MCP, contexto adaptativo e telemetria em um processo de desenvolvimento durável: compreender o projeto, editar, testar, verificar a prévia e entregar um draft PR. Toda etapa deixa evidência para melhorar o processo com avaliações controladas.

O plano contém **10 milestones e 44 stories**, cada uma com dependências, entregáveis, critérios de aceite, validação, instrumentação e espaço para evidências. A existência de uma fundação atual não significa que o aceite futuro esteja concluído.

## Documentos de referência

- [Requisitos e cobertura por story](REQUIREMENTS.md).
- [Arquitetura, políticas e contratos propostos](ARCHITECTURE.md).
- [Telemetria profunda e contrato de auditoria](TELEMETRY.md).
- [Matriz de validação e critérios de entrega](VALIDATION.md).
- [Estado atual e limites conhecidos](BASELINE.md).

## Milestones

| Milestone | Resultado | Stories | Status |
| --- | --- | --- | --- |
| [M00](M00/MILESTONE.md) | Contratos compartilhados e linha de base | 4 | in_progress (3/4) |
| [M01](M01/MILESTONE.md) | Telemetria profunda desde a fundação | 5 | in_progress (4/5) |
| [M02](M02/MILESTONE.md) | Entendimento do projeto e edição precisa | 5 | in_progress (5/5) |
| [M03](M03/MILESTONE.md) | Execução durável e controle do trabalho | 6 | in_progress (6/6) |
| [M04](M04/MILESTONE.md) | Operação pela dashboard, Telegram e MCP | 4 | in_progress (2/4) |
| [M05](M05/MILESTONE.md) | Browser isolado e validação funcional | 4 | in_progress (3/4) |
| [M06](M06/MILESTONE.md) | GitHub App e entrega automática em draft | 4 | in_progress (1/4) |
| [M07](M07/MILESTONE.md) | Contexto eficiente e fallback de modelo | 4 | in_progress (1/4) |
| [M08](M08/MILESTONE.md) | Avaliação e melhoria controlada | 4 | in_progress (3/4) |
| [M09](M09/MILESTONE.md) | Validação integrada e adoção gradual | 4 | in_progress (1/4) |

## Ordem de execução

1. M00 fixa contratos, políticas e baseline; M01 estabelece telemetria persistente antes dos efeitos novos.
2. M02 entrega entendimento/edição; M03 usa essa base para trabalho durável. As dependências exatas estão nas stories.
3. M04 disponibiliza configuração e controle nas interfaces. M05 acrescenta verificação funcional e M06 entrega em draft PR.
4. M07 melhora contexto e latência. Parte de M07 pode avançar após suas dependências sem esperar a publicação GitHub.
5. M08 usa as evidências acumuladas para avaliações e promoção controlada. M09 valida a integração e a adoção por dois bots.

A ordem numérica é o roteiro recomendado. O grafo das dependências de stories define o que pode começar; não se exige concluir um milestone inteiro quando uma story depende apenas de uma parte dele.

## Decisões já tomadas

- Tudo é reutilizável; o Dev é apenas o primeiro piloto. Nenhuma regra de domínio depende do seu nome, canal ou ID.
- Autonomia configurável até draft PR, retomada automática e um run de programação ativo por bot.
- Merge, deploy e efeitos destrutivos exigem pedido explícito. Trabalho de análise não modifica projetos.
- Usar GitHub App e tokens temporários; credenciais não ficam acessíveis ao código executado na sandbox.
- Browser testa prévias e consulta documentação pública; credenciais de teste são separadas por projeto.
- Fallback fast → principal em 15 segundos sem saída útil ou indisponibilidade, uma troca automática por chamada lógica.
- **Sem teto financeiro.** Consumo integralmente visível, custos indisponíveis identificados; limites técnicos de execução continuam possíveis.
- Telemetria profunda integra todas as stories. Melhorias de produção precisam de validação, versionamento, aprovação e rollback.

## Como executar este backlog

Começar pela story elegível, revisar blueprint/contratos existentes e registrar implementação e evidências na própria story. Marcar checkboxes somente após comprovação. Usar `pending`, `in_progress`, `blocked` ou `completed`, com justificativa e referência. Não converter testes simulados em aceite real nem atualizar todos os status em lote por um único build verde.

Antes de implementar, atualizar o blueprint da capacidade nova conforme M00-S01. Este diretório é o backlog detalhado da evolução, não uma declaração de disponibilidade atual. A documentação da arquitetura existente permanece referência; decisões explícitas do usuário neste plano prevalecem em caso de conflito, inclusive ausência de teto financeiro.

## Fora do escopo

Automerge, autodeploy, force push automático, treinamento/fine-tuning de modelos, múltiplos agentes autônomos e reutilização de perfis pessoais de browser. A melhoria aqui é do processo, das políticas e das ferramentas mediante avaliação, não treinamento de pesos do modelo.
