import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CapturePolicySchema, type CapturePolicy } from '../contracts.js';
import { ProgrammingError } from '../errors.js';
import { catalogEntry, type TelemetryEventType } from './catalog.js';
import { applyCapture, redactText, redactValue } from './redaction.js';

export const TELEMETRY_SCHEMA_VERSION = 1;

export const EventStatusSchema = z.enum(['started', 'succeeded', 'failed', 'denied', 'uncertain', 'info']);
export type EventStatus = z.infer<typeof EventStatusSchema>;

const Id = z.string().min(1).max(300);
/**
 * Loose on purpose: consumers ignore fields they do not know, and envelopes
 * from other schema versions still parse as long as the minimum is present.
 */
export const TelemetryEnvelopeSchema = z.looseObject({
  schemaVersion: z.number().int().positive(),
  eventId: z.string().min(1),
  type: z.string().regex(/^[a-z][a-z0-9_]*$/),
  producer: z.string().min(1).max(200),
  seq: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
  botId: Id.optional(),
  projectId: Id.optional(),
  taskId: Id.optional(),
  runId: Id.optional(),
  stepId: Id.optional(),
  operationId: Id.optional(),
  traceId: Id.optional(),
  spanId: Id.optional(),
  parentSpanId: Id.optional(),
  attemptId: Id.optional(),
  attempt: z.number().int().positive().optional(),
  status: EventStatusSchema,
  durationMs: z.number().nonnegative().optional(),
  error: z
    .object({ code: z.string(), message: z.string(), retryable: z.boolean() })
    .optional(),
  policyVersion: z.string().optional(),
  capture: CapturePolicySchema,
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type TelemetryEnvelope = z.infer<typeof TelemetryEnvelopeSchema>;

export interface Correlation {
  botId?: string;
  projectId?: string;
  taskId?: string;
  runId?: string;
  stepId?: string;
  operationId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  attemptId?: string;
  attempt?: number;
  policyVersion?: string;
}

export interface EventInput extends Correlation {
  type: TelemetryEventType;
  status?: EventStatus;
  durationMs?: number;
  error?: { code: string; message: string; retryable: boolean };
  payload?: Record<string, unknown>;
  occurredAt?: number;
}

/**
 * Builds a validated, redacted envelope. Redaction runs before capture, so
 * even `full` never persists a secret. Unknown types are a programming error.
 */
export function buildEnvelope(
  input: EventInput,
  producer: string,
  seq: number,
  capture: CapturePolicy,
  secrets: readonly string[] = [],
  now = Date.now(),
): TelemetryEnvelope {
  const entry = catalogEntry(input.type);
  if (!entry)
    throw new ProgrammingError('invalid_request', `Evento fora do catálogo: ${String(input.type)}.`);
  const redacted = input.payload
    ? (redactValue(input.payload, secrets) as Record<string, unknown>)
    : undefined;
  if (redacted) {
    const parsed = entry.payload.safeParse(redacted);
    if (!parsed.success)
      throw new ProgrammingError('invalid_request', `Payload inválido para ${input.type}.`, {
        details: { issues: parsed.error.issues.map((issue) => issue.path.join('.')) },
      });
  }
  const payload = applyCapture(redacted, capture, entry.safe);
  const { type, status, durationMs, error, occurredAt, payload: _payload, ...correlation } = input;
  void _payload;
  const envelope: TelemetryEnvelope = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    eventId: randomUUID(),
    type,
    producer,
    seq,
    occurredAt: occurredAt ?? now,
    ...Object.fromEntries(Object.entries(correlation).filter(([, value]) => value !== undefined)),
    status: status ?? 'info',
    ...(durationMs !== undefined && { durationMs: Math.max(0, Math.round(durationMs)) }),
    ...(error && {
      error: { ...error, message: redactText(error.message, secrets).slice(0, 2000) },
    }),
    capture,
    ...(payload && { payload }),
  };
  return TelemetryEnvelopeSchema.parse(envelope);
}

export function parseEnvelope(value: unknown): TelemetryEnvelope {
  return TelemetryEnvelopeSchema.parse(value);
}
