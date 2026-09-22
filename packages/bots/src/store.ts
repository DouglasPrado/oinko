import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  BotDefinitionSchema,
  BotSecretsSchema,
  BotId,
  BotError,
  type BotProfile,
  type BotSecrets,
} from './schema.js';

interface Paths {
  dataDir: string;
  telemetryDbPath: string;
  higgsfieldCredentialPath?: string;
}
interface Row {
  config: string;
  secrets: string;
  revision: number;
  paths: string;
}

export class BotStore {
  readonly root: string;
  private readonly db: DatabaseSync;
  private readonly key: Buffer;
  private closed = false;
  constructor(root: string) {
    this.root = resolve(root);
    const directory = join(this.root, '.harness');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyPath = join(directory, 'bots.key');
    const path = join(directory, 'bots.db');
    if (existsSync(path) && !existsSync(keyPath))
      throw new BotError('A chave local dos bots está ausente. Restaure bots.key do backup.');
    try {
      writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    this.key = readFileSync(keyPath);
    if (this.key.length !== 32) throw new BotError('A chave local dos bots é inválida.');
    chmodSync(keyPath, 0o600);
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, config TEXT NOT NULL, secrets TEXT NOT NULL, revision INTEGER NOT NULL, paths TEXT NOT NULL); CREATE TABLE IF NOT EXISTS bot_operation (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, expires_at INTEGER);',
    );
  }
  private encrypt(secrets: BotSecrets): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(secrets), 'utf8'), cipher.final()]);
    return JSON.stringify({
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      data: data.toString('hex'),
    });
  }
  private decrypt(value: string): BotSecrets {
    const box = JSON.parse(value) as { iv: string; tag: string; data: string };
    const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(box.iv, 'hex'));
    cipher.setAuthTag(Buffer.from(box.tag, 'hex'));
    return BotSecretsSchema.parse(
      JSON.parse(
        Buffer.concat([cipher.update(Buffer.from(box.data, 'hex')), cipher.final()]).toString(
          'utf8',
        ),
      ),
    );
  }
  private row(id: string): Row {
    BotId.parse(id);
    const row = this.db.prepare('SELECT * FROM bots WHERE id = ?').get(id) as unknown as
      Row | undefined;
    if (!row) throw new BotError('Bot não encontrado.');
    return row;
  }
  has(id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM bots WHERE id = ?').get(id));
  }
  runtime(id: string) {
    const row = this.row(id);
    return {
      definition: BotDefinitionSchema.parse(JSON.parse(row.config)),
      secrets: this.decrypt(row.secrets),
      revision: row.revision,
      paths: JSON.parse(row.paths) as Paths,
    };
  }
  get(id: string): BotProfile {
    const { definition, secrets, revision } = this.runtime(id);
    return {
      ...definition,
      revision,
      hasApiKey: Boolean(secrets.apiKey),
      hasTelegramToken: Boolean(secrets.telegramToken),
      hasTranscriptionKey: Boolean(secrets.transcriptionKey),
      mcpCredentials: Object.keys(secrets.mcpTokens ?? {}).filter((key) =>
        Boolean(secrets.mcpTokens?.[key]),
      ),
    };
  }
  list(): BotProfile[] {
    return (this.db.prepare('SELECT id FROM bots ORDER BY id').all() as { id: string }[]).map(
      ({ id }) => this.get(id),
    );
  }
  save(
    input: unknown,
    secretInput: unknown,
    expectedRevision: number,
    importedPaths?: Paths,
  ): BotProfile {
    const definition = BotDefinitionSchema.parse(input);
    const changes = BotSecretsSchema.parse(secretInput);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.has(definition.id) ? this.runtime(definition.id) : undefined;
      if ((current?.revision ?? 0) !== expectedRevision)
        throw new BotError('Este bot foi alterado. Recarregue antes de salvar.');
      const secrets: BotSecrets = { ...current?.secrets };
      for (const field of ['apiKey', 'telegramToken', 'transcriptionKey'] as const)
        if (changes[field]?.trim()) secrets[field] = changes[field].trim();
      secrets.mcpTokens = { ...secrets.mcpTokens };
      for (const [id, token] of Object.entries(changes.mcpTokens ?? {}))
        if (token.trim()) secrets.mcpTokens[id] = token.trim();
      for (const id of Object.keys(secrets.mcpTokens))
        if (!definition.mcps.some((mcp) => mcp.id === id)) delete secrets.mcpTokens[id];
      const dataDir = join(this.root, '.harness', 'bots', definition.id);
      const paths = current?.paths ??
        importedPaths ?? { dataDir, telemetryDbPath: join(dataDir, 'telemetry.db') };
      this.db
        .prepare(
          'INSERT INTO bots VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET config=excluded.config, secrets=excluded.secrets, revision=excluded.revision',
        )
        .run(
          definition.id,
          JSON.stringify(definition),
          this.encrypt(secrets),
          expectedRevision + 1,
          JSON.stringify(paths),
        );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.get(definition.id);
  }
  acquire(owner: string): boolean {
    return (
      Number(
        this.db
          .prepare(
            'INSERT INTO bot_operation VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at WHERE bot_operation.expires_at < ?',
          )
          .run(owner, Date.now() + 120_000, Date.now()).changes,
      ) === 1
    );
  }
  release(owner: string): void {
    this.db.prepare('DELETE FROM bot_operation WHERE owner = ?').run(owner);
  }
  close(): void {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }
}
