import { createHash } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

/** Caracteres do `preview` guardado junto da linha. */
const DEFAULT_PREVIEW_CHARS = 2_048;

export interface PayloadRef {
  /** sha256 do conteudo — a chave primaria, e por isso o armazenamento dedupe. */
  id: string;
  /** Tamanho em bytes UTF-8, nao em caracteres. */
  sizeBytes: number;
  /** Inicio do conteudo, suficiente para a UI listar sem carregar o corpo. */
  preview: string;
}

export interface PutPayloadOptions {
  /** Se o conteudo ja passou pela redacao. Default true. */
  redacted?: boolean;
  /** Caracteres do preview. Default 2048. */
  previewChars?: number;
  /**
   * Grava o corpo. Com `false`, a linha guarda identidade e tamanho reais mas
   * corpo vazio — o modo `hashed`, para quem mede volume sem reter conteudo.
   */
  storeBody?: boolean;
  /** Relogio injetavel, para teste. */
  now?: number;
}

/**
 * Guarda os corpos grandes da telemetria — prompt, resposta crua, argumentos e
 * resultado de tool — enderecados por hash do conteudo.
 *
 * O enderecamento por conteudo e o que torna a captura integral viavel: o
 * system prompt e byte-a-byte o mesmo em todas as chamadas de uma execucao, e
 * sem dedup os mesmos 184 KB seriam gravados uma vez por chamada.
 */
export class PayloadStore {
  private readonly upsert: StatementSync;
  private readonly select: StatementSync;

  constructor(db: DatabaseSync) {
    // ON CONFLICT renova `created_at` de proposito. A purga apaga payload por
    // idade, e um prompt reusado por meses nao pode expirar embaixo das
    // execucoes que ainda apontam para ele.
    this.upsert = db.prepare(
      `INSERT INTO payloads (id, size_bytes, preview, redacted, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at`,
    );
    this.select = db.prepare('SELECT body FROM payloads WHERE id = ?');
  }

  put(content: string, options?: PutPayloadOptions): PayloadRef {
    const id = createHash('sha256').update(content, 'utf8').digest('hex');
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    const stored = options?.storeBody === false ? '' : content;
    const preview = stored.slice(0, options?.previewChars ?? DEFAULT_PREVIEW_CHARS);
    const redacted = options?.redacted === false ? 0 : 1;

    this.upsert.run(id, sizeBytes, preview, redacted, stored, options?.now ?? Date.now());

    return { id, sizeBytes, preview };
  }

  get(id: string): string | undefined {
    const row = this.select.get(id) as { body: string } | undefined;
    return row?.body;
  }
}
