import 'server-only';
import { telemetryDb } from './telemetry-connection';

export interface PayloadChunk {
  chunk: string;
  offset: number;
  limit: number;
  totalBytes: number;
  truncated: boolean;
}

/** Corpo completo de um payload, em pedacos. Chamado so quando alguem expande. */
export function getPayloadChunk(
  id: string,
  offset: number,
  limit: number,
  database = telemetryDb(),
): PayloadChunk | undefined {
  const row = database.prepare('SELECT body, size_bytes FROM payloads WHERE id = ?').get(id) as
    { body: string; size_bytes: number } | undefined;

  if (!row) return undefined;

  const chunk = row.body.slice(offset, offset + limit);
  return {
    chunk,
    offset,
    limit,
    totalBytes: row.size_bytes,
    truncated: offset + chunk.length < row.body.length,
  };
}
