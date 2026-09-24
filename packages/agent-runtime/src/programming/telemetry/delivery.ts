import { TelemetryDatabase } from '@oinko/core';
import type { ProgrammingDatabase } from '../store/database.js';
import { parseEnvelope, type TelemetryEnvelope } from './envelope.js';
import type { TelemetryJournal } from './journal.js';

/** Where delivered events land. Writes must be idempotent by `eventId`. */
export interface TelemetryRepository {
  readonly name: string;
  write(envelopes: readonly TelemetryEnvelope[]): void | Promise<void>;
}

/**
 * Repository backed by a bot's `telemetry.db` (SDK migration v3). Opened per
 * batch: the dashboard and the bot worker share the file, and a failure here
 * must never corrupt the durable journal.
 */
export class SqliteTelemetryRepository implements TelemetryRepository {
  constructor(
    readonly name: string,
    private readonly path: string,
  ) {}

  write(envelopes: readonly TelemetryEnvelope[]): void {
    const database = new TelemetryDatabase(this.path);
    database.initialize();
    try {
      const insert = database.db.prepare(
        `INSERT OR IGNORE INTO telemetry_events (event_id, schema_version, type, producer, seq, status,
           bot_id, project_id, task_id, run_id, step_id, operation_id, trace_id, span_id,
           parent_span_id, duration_ms, envelope_json, occurred_at, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      database.transaction(() => {
        for (const envelope of envelopes)
          insert.run(
            envelope.eventId,
            envelope.schemaVersion,
            envelope.type,
            envelope.producer,
            envelope.seq,
            envelope.status,
            envelope.botId ?? null,
            envelope.projectId ?? null,
            envelope.taskId ?? null,
            envelope.runId ?? null,
            envelope.stepId ?? null,
            envelope.operationId ?? null,
            envelope.traceId ?? null,
            envelope.spanId ?? null,
            envelope.parentSpanId ?? null,
            envelope.durationMs ?? null,
            JSON.stringify(envelope),
            envelope.occurredAt,
            Date.now(),
          );
      });
    } finally {
      database.close();
    }
  }
}

export interface DeliveryReport {
  delivered: number;
  pending: number;
  degraded: string[];
}

/**
 * Drains the outbox into repositories. Delivery failures leave events pending
 * and journal `telemetry_delivery_degraded` once per outage; the first batch
 * that goes through afterwards journals `telemetry_recovered`.
 */
export class TelemetryDeliverer {
  private readonly degraded = new Set<string>();
  private timer?: NodeJS.Timeout;
  private running?: Promise<DeliveryReport>;

  constructor(
    private readonly database: ProgrammingDatabase,
    private readonly journal: TelemetryJournal,
    private readonly target: (botId: string | undefined) => TelemetryRepository | undefined,
    private readonly options: { batchSize?: number; now?: () => number } = {},
  ) {}

  flush(): Promise<DeliveryReport> {
    this.running ??= this.drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async drain(): Promise<DeliveryReport> {
    const now = this.options.now ?? Date.now;
    const rows = this.database.db
      .prepare(
        'SELECT id, bot_id, envelope_json FROM telemetry_outbox WHERE delivered_at IS NULL ORDER BY id LIMIT ?',
      )
      .all(this.options.batchSize ?? 500) as { id: number; bot_id: string | null; envelope_json: string }[];
    const groups = new Map<string, { repository: TelemetryRepository; rows: typeof rows }>();
    const undeliverable: number[] = [];
    for (const row of rows) {
      const repository = this.target(row.bot_id ?? undefined);
      if (!repository) {
        // No repository for this scope (e.g. telemetry disabled): the journal
        // itself stays the record; mark handled so it does not block others.
        undeliverable.push(row.id);
        continue;
      }
      const group = groups.get(repository.name) ?? { repository, rows: [] };
      group.rows.push(row);
      groups.set(repository.name, group);
    }
    const mark = this.database.db.prepare(
      'UPDATE telemetry_outbox SET delivered_at = ?, attempts = attempts + 1 WHERE id = ?',
    );
    const fail = this.database.db.prepare(
      'UPDATE telemetry_outbox SET attempts = attempts + 1 WHERE id = ?',
    );
    this.database.transaction(() => undeliverable.forEach((id) => mark.run(now(), id)));
    let delivered = 0;
    for (const [name, group] of groups) {
      try {
        await group.repository.write(group.rows.map((row) => parseEnvelope(JSON.parse(row.envelope_json))));
        this.database.transaction(() => group.rows.forEach((row) => mark.run(now(), row.id)));
        delivered += group.rows.length;
        // The destination belongs to one bot: its runs show the outage.
        const botId = group.rows[0]?.bot_id ?? undefined;
        if (this.degraded.delete(name))
          this.journal.emit({
            type: 'telemetry_recovered',
            status: 'succeeded',
            ...(botId && { botId }),
            payload: { target: name, delivered: group.rows.length },
          });
      } catch (error) {
        this.database.transaction(() => group.rows.forEach((row) => fail.run(row.id)));
        if (!this.degraded.has(name)) {
          this.degraded.add(name);
          const botId = group.rows[0]?.bot_id ?? undefined;
          this.journal.emit({
            type: 'telemetry_delivery_degraded',
            status: 'failed',
            ...(botId && { botId }),
            error: {
              code: 'delivery_failed',
              message: error instanceof Error ? error.message : 'Falha de entrega.',
              retryable: true,
            },
            payload: { target: name, code: 'delivery_failed', pending: group.rows.length },
          });
        }
      }
    }
    const pending = this.database.db
      .prepare('SELECT COUNT(*) AS n FROM telemetry_outbox WHERE delivered_at IS NULL')
      .get() as { n: number };
    return { delivered, pending: pending.n, degraded: [...this.degraded] };
  }

  start(intervalMs = 2000): void {
    this.stop();
    this.timer = setInterval(() => void this.flush().catch(() => undefined), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
