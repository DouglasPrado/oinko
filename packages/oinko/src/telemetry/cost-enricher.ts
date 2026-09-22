import type { GenerationStats } from '../llm/llm-client.js';
import { GenerationNotReadyError } from '../llm/errors.js';
import { retry } from '../utils/retry.js';
import type { Logger } from '../utils/logger.js';
import type { TelemetryDatabase } from './telemetry-database.js';

export interface CostEnricherOptions {
  /** Tentativas alem da primeira. Default 4. */
  maxRetries?: number;
  /** Espera inicial do backoff, em ms. Default 1500. */
  initialDelay?: number;
  /** Chamadas em voo ao mesmo tempo. Default 2. */
  concurrency?: number;
  logger?: Logger;
}

interface PendingCall {
  id: string;
  generation_id: string | null;
}

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_INITIAL_DELAY = 1_500;
const MAX_DELAY = 30_000;
/** Quantas pendencias recuperar no boot. */
const RECOVER_LIMIT = 200;

/**
 * Fecha a conta de custo das chamadas que o stream deixou em aberto.
 *
 * O `usage.cost` que vem no stream ja e o valor cobrado, mas nem sempre esta
 * pronto quando a resposta termina. Este enriquecedor busca o que ficou
 * pendente no endpoint de geracao do provedor, sempre fora do caminho do turno.
 *
 * A regra que sustenta o numero: esgotar as tentativas mantem a chamada em
 * `pending`, nunca em `unavailable`. "Ainda nao sei" continua sendo perseguido
 * no proximo boot; "nao da para saber" e reservado a quem nao tem como
 * informar — provedor sem custo na API, ou chamada sem id de geracao. Custo
 * jamais e estimado.
 */
export class CostEnricher {
  private readonly maxRetries: number;
  private readonly initialDelay: number;
  private inFlight = new Set<Promise<void>>();

  constructor(
    private readonly database: TelemetryDatabase,
    private readonly fetchGeneration: (id: string) => Promise<GenerationStats>,
    private readonly options: CostEnricherOptions = {},
  ) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.initialDelay = options.initialDelay ?? DEFAULT_INITIAL_DELAY;
  }

  /** Enfileira as chamadas ainda sem custo confirmado de uma execucao. */
  enqueue(traceId: string): void {
    const pending = this.database.db
      .prepare(
        `SELECT id, generation_id FROM llm_calls
         WHERE trace_id = ? AND cost_status = 'pending'`,
      )
      .all(traceId) as unknown as PendingCall[];

    if (pending.length === 0) return;
    this.start(traceId, pending);
  }

  /**
   * Reenfileira o que um processo anterior deixou pendente.
   *
   * Sem isto, um restart no intervalo entre a resposta e a confirmacao perderia
   * o custo daquela chamada para sempre.
   */
  recoverPending(): number {
    const rows = this.database.db
      .prepare(
        `SELECT DISTINCT trace_id FROM llm_calls
         WHERE cost_status = 'pending' AND generation_id IS NOT NULL
         ORDER BY started_at DESC LIMIT ${RECOVER_LIMIT}`,
      )
      .all() as unknown as { trace_id: string }[];

    for (const row of rows) this.enqueue(row.trace_id);
    return rows.length;
  }

  /** Espera o que esta em voo. Para encerramento limpo e para teste. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  private start(traceId: string, pending: readonly PendingCall[]): void {
    const task = this.process(traceId, pending).catch(() => {
      // Instrumentacao nao propaga falha.
    });
    this.inFlight.add(task);
    void task.finally(() => this.inFlight.delete(task));
  }

  private async process(traceId: string, pending: readonly PendingCall[]): Promise<void> {
    const concurrency = this.options.concurrency ?? 2;
    const queue = [...pending];

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (;;) {
        const call = queue.shift();
        if (!call) return;
        await this.settle(call);
      }
    });

    await Promise.all(workers);
    this.rollUp(traceId);
  }

  private async settle(call: PendingCall): Promise<void> {
    // Sem id de geracao nao ha o que perguntar: definitivo, e sem gastar rede.
    if (call.generation_id === null) {
      this.database.db
        .prepare("UPDATE llm_calls SET cost_status = 'unavailable' WHERE id = ?")
        .run(call.id);
      return;
    }

    const generationId = call.generation_id;
    let attempts = 0;

    try {
      const stats = await retry(
        () => {
          attempts++;
          return this.fetchGeneration(generationId);
        },
        {
          maxRetries: this.maxRetries,
          initialDelay: this.initialDelay,
          maxDelay: MAX_DELAY,
          isRetryable: (err) => err instanceof GenerationNotReadyError,
        },
      );

      // Atribuicao, nunca soma: um enriquecimento repetido nao pode dobrar a
      // fatura.
      this.database.db
        .prepare(
          `UPDATE llm_calls SET
             cost_usd = ?, upstream_cost_usd = ?, cache_discount_usd = ?,
             provider_name = COALESCE(?, provider_name),
             native_finish_reason = COALESCE(?, native_finish_reason),
             cached_tokens = COALESCE(?, cached_tokens),
             reasoning_tokens = COALESCE(?, reasoning_tokens),
             cost_status = 'confirmed', cost_source = 'generation_api',
             cost_attempts = cost_attempts + ?
           WHERE id = ?`,
        )
        .run(
          stats.totalCostUsd,
          stats.upstreamCostUsd ?? null,
          stats.cacheDiscountUsd ?? null,
          stats.providerName ?? null,
          stats.nativeFinishReason ?? null,
          stats.cachedTokens ?? null,
          stats.reasoningTokens ?? null,
          attempts,
          call.id,
        );
    } catch (err) {
      // Continua pendente de proposito: sera retomado no proximo boot.
      this.database.db
        .prepare('UPDATE llm_calls SET cost_attempts = cost_attempts + ? WHERE id = ?')
        .run(attempts, call.id);

      this.options.logger?.debug('Cost enrichment still pending', {
        generationId,
        attempts,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Recalcula o custo da execucao a partir das chamadas, sempre por SUM. */
  private rollUp(traceId: string): void {
    this.database.db
      .prepare(
        `UPDATE executions SET
           cost_usd = (SELECT SUM(cost_usd) FROM llm_calls WHERE trace_id = ?1),
           cost_status = CASE
             WHEN EXISTS (SELECT 1 FROM llm_calls WHERE trace_id = ?1 AND cost_status = 'pending')
               THEN 'pending'
             WHEN (SELECT SUM(cost_usd) FROM llm_calls WHERE trace_id = ?1) IS NULL
               THEN 'unavailable'
             ELSE 'confirmed'
           END
         WHERE trace_id = ?1`,
      )
      .run(traceId);
  }
}
