import 'server-only';
import type { PayloadRef } from '@/features/conversation/schemas/timeline.schema';

/**
 * SELECT de referencia a um payload, sem o corpo.
 *
 * Trazer `body` numa listagem seria carregar megabytes para renderizar um
 * rotulo de tamanho; o corpo so e buscado quando alguem pede para ver.
 */
export function payloadJoin(alias: string, column: string, join: string): string {
  return `LEFT JOIN payloads ${alias} ON ${alias}.id = ${join}.${column}`;
}

export function payloadColumns(alias: string, prefix: string): string {
  return [
    `${alias}.id AS ${prefix}_id`,
    `${alias}.size_bytes AS ${prefix}_size`,
    `${alias}.preview AS ${prefix}_preview`,
    `${alias}.redacted AS ${prefix}_redacted`,
  ].join(', ');
}

export function toPayloadRef(row: Record<string, unknown>, prefix: string): PayloadRef | null {
  const id = row[`${prefix}_id`];
  if (typeof id !== 'string') return null;

  const preview = row[`${prefix}_preview`];

  return {
    id,
    sizeBytes: Number(row[`${prefix}_size`] ?? 0),
    preview: typeof preview === 'string' ? preview : '',
    redacted: Number(row[`${prefix}_redacted`] ?? 1) === 1,
  };
}
