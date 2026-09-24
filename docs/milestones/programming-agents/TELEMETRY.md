# Telemetria profunda e contrato de auditoria

**Status:** contrato fixado em M01-S01; implementação em `packages/agent-runtime/src/programming/telemetry/`. [Voltar ao plano](README.md).

## Envelope (schemaVersion 1)

Todo evento de programação é um envelope versionado. Campos novos são opcionais; consumidores ignoram campos desconhecidos e aceitam `schemaVersion` anterior.

| Campo | Obrigatório | Significado |
| --- | --- | --- |
| `schemaVersion` | sim | Versão do envelope (inteiro). |
| `eventId` | sim | UUID estável; chave de deduplicação na entrega. |
| `type` | sim | Nome do catálogo abaixo (snake_case). |
| `producer` / `seq` | sim | Produtor (`runtime:<botId>`, `runner`, `dashboard`, `mcp`, `channel:<tipo>`) e sequência monotônica dele; ordena e detecta lacunas. |
| `occurredAt` | sim | Epoch ms do fato. |
| `botId`, `projectId`, `taskId`, `runId`, `stepId`, `operationId` | conforme escopo | Correlação explícita; nunca inferida por horário. Início de conversa pode não ter projeto. |
| `traceId`, `spanId`, `parentSpanId` | spans | `traceId` do LLM quando houver; `spanId` único; pai rastreável. |
| `attemptId`, `attempt` | retries | Retry mantém `operationId` e muda `attemptId`. |
| `status` | sim | `started`, `succeeded`, `failed`, `denied`, `uncertain`, `info`. |
| `durationMs` | spans finalizados | Duração do próprio span. |
| `error` | falhas | `{ code, message, retryable }` já redigido. |
| `policyVersion` | quando há run | Hash do snapshot de política efetiva. |
| `capture` | sim | `full`, `hashed` ou `none` aplicado ao `payload`. |
| `payload` | não | Dados do tipo, após redaction e política de captura. |

Captura `none` mantém o envelope e remove o `payload` (exceto contagens numéricas e identificadores não sensíveis). `hashed` troca strings do payload por `sha256:<hex>` + tamanho. Segredos são redigidos **antes** de qualquer persistência ou transmissão, em qualquer política.

Decisões registradas (`decision_recorded`) são declarações observáveis (plano, escolha de ferramenta, critério avaliado), nunca cadeia de pensamento interna do modelo — ela não é capturada nem prometida.

## Entrega e durabilidade

1. Efeitos mutáveis gravam `operation_intended` (recibo `intended`) na mesma transação que o estado do run. Se isso falhar, a mutação não acontece e o run é bloqueado com motivo.
2. Eventos entram no outbox do `programming.db`; o entregador copia para `telemetry_events` do banco do bot com `INSERT OR IGNORE` por `eventId`. Reenvio não duplica custos nem operações.
3. Falha de entrega gera `telemetry_delivery_degraded` no journal; ao drenar o atraso, `telemetry_recovered`. Operações continuam enquanto o journal durável funciona.
4. Recibo sem resultado final após crash vira `uncertain` e só sai desse estado por reconciliação (`operation_reconciled`).

## Catálogo

| Categoria | Tipos |
| --- | --- |
| Run | `run_created`, `run_state_changed`, `run_queued`, `run_dispatched`, `request_deduplicated`, `queue_wait_measured`, `run_blocked`, `run_resumed`, `run_paused`, `run_cancelled`, `run_completed`, `run_observed`, `checkpoint_saved`, `step_created` |
| Política e acesso | `policy_resolved`, `permission_checked`, `permission_denied`, `capability_changed`, `bot_configuration_changed`, `project_configuration_changed`, `model_policy_changed` |
| Migração | `migration_started`, `migration_finished` |
| Spans e decisões | `telemetry_span_started`, `telemetry_span_finished`, `decision_recorded` |
| Operações | `operation_intended`, `operation_finished`, `operation_uncertain`, `operation_reconciled`, `process_terminated` |
| Entrega | `telemetry_delivery_degraded`, `telemetry_recovered` |
| Artefatos | `artifact_created`, `artifact_accessed`, `artifact_expired`, `capture_policy_applied`, `evidence_opened`, `evidence_invalidated`, `revision_observed` |
| Uso | `usage_reported`, `usage_reconciled`, `run_metrics_updated` |
| Consulta | `telemetry_query` (sem corpo sensível dos filtros) |
| Workspace | `workspace_search`, `workspace_read`, `workspace_edit_intended`, `workspace_edit_finished`, `workspace_edit_conflict`, `project_instructions_resolved`, `project_commands_discovered`, `git_diff_captured`, `check_started`, `check_finished` |
| Ciclos | `cycle_started`, `progress_assessed`, `cycle_continued`, `recovery_started`, `recovery_blocked` |
| Controle | `control_requested`, `user_direction_received`, `plan_revised`, `acceptance_evaluated` |
| Canais e MCP | `channel_request_received`, `progress_notification_sent`, `notification_failed`, `mcp_call_started`, `mcp_call_finished` |
| Browser | `browser_session_created`, `browser_session_closed`, `browser_session_failed`, `browser_navigation_allowed`, `browser_navigation_denied`, `test_credential_used`, `browser_action_started`, `browser_action_finished`, `browser_console_error`, `browser_network_error` |
| Prévia | `preview_started`, `preview_ready`, `preview_failed`, `functional_check_finished` |
| GitHub | `github_installation_checked`, `github_token_issued`, `github_permission_denied`, `publication_reviewed`, `git_commit_created`, `git_push_started`, `git_push_finished`, `pull_request_reconciled`, `draft_pull_request_created`, `draft_pull_request_updated`, `publication_blocked`, `ci_poll_finished`, `ci_check_updated`, `ci_status_unavailable` |
| Contexto e modelo | `summary_scheduled`, `summary_finished`, `summary_discarded`, `context_preparation_pending`, `routing_decision`, `tools_selected`, `tools_expanded`, `context_assembled`, `history_retrieved`, `model_fallback_triggered`, `model_attempt_cancelled`, `model_attempt_finished`, `efficiency_comparison_generated` |
| Avaliação e melhoria | `evaluation_started`, `evaluation_dataset_created`, `evaluation_case_started`, `evaluation_case_finished`, `improvement_opportunity_detected`, `evaluation_comparison_created`, `candidate_created`, `candidate_evaluated`, `promotion_approved`, `policy_promoted`, `policy_rolled_back`, `improvement_report_generated`, `evaluation_exported`, `post_promotion_regression_detected` |
| Validação e adoção | `validation_suite_started`, `validation_suite_finished`, `real_evaluation_finished`, `acceptance_reviewed`, `pilot_enabled`, `cross_bot_isolation_verified`, `rollout_reviewed`, `delivery_audited`, `milestone_accepted` |

O schema de payload de cada tipo está em `telemetry/catalog.ts`; `catalog.test.ts` valida todos os tipos listados aqui contra o código.

## Acesso e retenção

- Consulta, download e exportação exigem identidade autorizada no projeto/bot; ID adivinhado recebe o mesmo erro que ID inexistente.
- Retenção padrão: 30 dias para eventos, conforme `telemetry.retentionDays` do bot; artefatos seguem `expiresAt`. Recibos de runs ativos, pausados, bloqueados ou com operação `uncertain` nunca expiram antes da conclusão.
- Expiração vira indisponibilidade explícita (`artifact_expired`), nunca conteúdo vazio.
