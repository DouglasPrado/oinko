import { randomUUID } from 'node:crypto';
import type { CapturePolicy } from '../contracts.js';
import { ProgrammingError } from '../errors.js';
import type { ProgrammingDatabase } from '../store/database.js';
import {
  buildEnvelope,
  parseEnvelope,
  type Correlation,
  type EventInput,
  type EventStatus,
  type TelemetryEnvelope,
} from './envelope.js';
import type { TelemetryEventType } from './catalog.js';

export interface JournalOptions {
  producer: string;
  /** Capture policy of the bot that owns the event; `full` when unknown. */
  capture?: (botId: string | undefined) => CapturePolicy;
  /** Literal secrets to scrub (API keys, tokens known to the host). */
  secrets?: () => readonly string[];
  now?: () => number;
}

export interface SpanHandle {
  spanId: string;
  correlation: Correlation;
  finish(
    status: Exclude<EventStatus, 'started' | 'info'>,
    payload?: Record<string, unknown>,
    error?: { code: string; message: string; retryable: boolean },
  ): TelemetryEnvelope;
}

/**
 * Durable journal: every event is validated, redacted, captured and appended
 * to the outbox inside the caller's transaction. A failure to journal throws,
 * so a mutation that depends on its intent being recorded never happens.
 */
export class TelemetryJournal {
  private readonly now: () => number;
  constructor(
    private readonly database: ProgrammingDatabase,
    private readonly options: JournalOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  get producer(): string {
    return this.options.producer;
  }

  emit(input: EventInput): TelemetryEnvelope {
    try {
      return this.database.transaction(() => {
        const row = this.database.db
          .prepare(
            `INSERT INTO producer_sequences (producer, seq) VALUES (?, 1)
             ON CONFLICT(producer) DO UPDATE SET seq = seq + 1 RETURNING seq`,
          )
          .get(this.options.producer) as { seq: number };
        const envelope = buildEnvelope(
          input,
          this.options.producer,
          row.seq,
          this.options.capture?.(input.botId) ?? 'full',
          this.options.secrets?.() ?? [],
          this.now(),
        );
        this.append(envelope);
        return envelope;
      });
    } catch (error) {
      // Catalog/payload mistakes are bugs and surface as such; anything else
      // means the journal cannot persist, which must stop the mutation.
      if (error instanceof ProgrammingError && error.code === 'invalid_request') throw error;
      throw new ProgrammingError(
        'intent_not_persisted',
        'Não foi possível registrar o evento no journal durável.',
        { details: { type: input.type } },
      );
    }
  }

  /** Appends an envelope produced elsewhere (e.g. by the runner), keeping its identity. */
  ingest(value: unknown): boolean {
    const envelope = parseEnvelope(value);
    return this.append(envelope);
  }

  private append(envelope: TelemetryEnvelope): boolean {
    const result = this.database.db
      .prepare(
        `INSERT OR IGNORE INTO telemetry_outbox (event_id, producer, seq, type, bot_id, project_id,
          run_id, step_id, operation_id, occurred_at, envelope_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        envelope.eventId,
        envelope.producer,
        envelope.seq,
        envelope.type,
        envelope.botId ?? null,
        envelope.projectId ?? null,
        envelope.runId ?? null,
        envelope.stepId ?? null,
        envelope.operationId ?? null,
        envelope.occurredAt,
        JSON.stringify(envelope),
      );
    return Number(result.changes) === 1;
  }

  /** Starts a span with a traceable parent; finishing it records the duration. */
  span(
    name: string,
    correlation: Correlation,
    payload: Record<string, unknown> = {},
  ): SpanHandle {
    const spanId = correlation.spanId ?? `span-${randomUUID()}`;
    const context = { ...correlation, spanId };
    const started = this.now();
    this.emit({
      type: 'telemetry_span_started',
      status: 'started',
      ...context,
      payload: { name, ...payload },
    });
    return {
      spanId,
      correlation: context,
      finish: (status, extra = {}, error) =>
        this.emit({
          type: 'telemetry_span_finished',
          status,
          ...context,
          durationMs: this.now() - started,
          ...(error && { error }),
          payload: { name, ...extra },
        }),
    };
  }

  /** Convenience for one-shot events. */
  record(
    type: TelemetryEventType,
    correlation: Correlation,
    payload?: Record<string, unknown>,
    status: EventStatus = 'info',
  ): TelemetryEnvelope {
    return this.emit({ type, status, ...correlation, ...(payload && { payload }) });
  }
}

export interface StoredEvent {
  id: number;
  envelope: TelemetryEnvelope;
  deliveredAt?: number;
}

/** Reads journaled events back, e.g. for tests and the run explorer. */
export function readJournal(
  database: ProgrammingDatabase,
  filter: { runId?: string; type?: string; afterId?: number; limit?: number } = {},
): StoredEvent[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.runId) {
    clauses.push('run_id = ?');
    params.push(filter.runId);
  }
  if (filter.type) {
    clauses.push('type = ?');
    params.push(filter.type);
  }
  if (filter.afterId !== undefined) {
    clauses.push('id > ?');
    params.push(filter.afterId);
  }
  const rows = database.db
    .prepare(
      `SELECT id, envelope_json, delivered_at FROM telemetry_outbox
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY id LIMIT ?`,
    )
    .all(...params, filter.limit ?? 10_000) as {
    id: number;
    envelope_json: string;
    delivered_at: number | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    envelope: parseEnvelope(JSON.parse(row.envelope_json)),
    ...(row.delivered_at !== null && { deliveredAt: row.delivered_at }),
  }));
}
