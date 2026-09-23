import 'server-only';
import { telemetryDb } from './telemetry-connection';

/**
 * Marca d'agua do banco: o bastante para saber que algo mudou.
 *
 * Contagens e o instante mais recente, nao um hash do conteudo — a pergunta
 * aqui e "chegou coisa nova?", e esta consulta usa indice e custa quase nada
 * mesmo repetida a cada segundo.
 */
export function telemetryWatermark(database = telemetryDb()): string {
  const row = database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM executions)       AS executions,
         (SELECT MAX(started_at) FROM executions) AS last,
         (SELECT COUNT(*) FROM llm_calls)        AS calls,
         (SELECT COUNT(*) FROM tool_calls)       AS tools,
         (SELECT COUNT(*) FROM decisions)        AS decisions,
         (SELECT COUNT(*) FROM mcp_calls)        AS mcp`,
    )
    .get() as Record<string, number | null> | undefined;

  return [
    row?.executions ?? 0,
    row?.last ?? 0,
    row?.calls ?? 0,
    row?.tools ?? 0,
    row?.decisions ?? 0,
    row?.mcp ?? 0,
  ].join(':');
}
