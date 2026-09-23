import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { LocalDatabase, WorkspaceError } from '@oinko/workspaces';
import {
  EnvironmentSchema,
  SettingsSchema,
  Variables,
  type Environment,
  type Job,
  type Preview,
} from '../contracts/index.js';
import type { PreparedCompose } from '../runtime/compose.js';

interface StoredEnvironment {
  id: string;
  definition: Environment;
  encrypted: string;
}
export class EnvironmentStore {
  private readonly db: LocalDatabase;
  private readonly key: Buffer;
  constructor(readonly root: string) {
    const dir = join(root, '.harness');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const keyPath = join(dir, 'environments.key');
    if (!existsSync(keyPath)) {
      if (existsSync(join(dir, 'environments.db')))
        throw new WorkspaceError('Chave de ambientes ausente. Restaure o backup da chave.');
      try {
        writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    this.key = readFileSync(keyPath);
    if (this.key.length !== 32) throw new WorkspaceError('Chave de ambientes inválida.');
    chmodSync(keyPath, 0o600);
    this.db = new LocalDatabase(join(dir, 'environments.db'));
  }
  private decode(encrypted: string): Record<string, string> {
    const data = Buffer.from(encrypted, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return z
      .record(z.string(), z.string())
      .parse(
        JSON.parse(
          Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
        ),
      );
  }
  private encode(value: Record<string, string>) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  private stored(id: string) {
    const value = this.db.get<StoredEnvironment>('environment', id);
    if (!value) throw new WorkspaceError('Ambiente não encontrado.');
    return value;
  }
  environment(id: string) {
    const saved = this.stored(id);
    return {
      ...saved.definition,
      revision: saved.revision,
      secretNames: Object.keys(this.decode(saved.encrypted)),
    };
  }
  environments() {
    return this.db.list<StoredEnvironment>('environment').map((env) => this.environment(env.id));
  }
  secrets(id: string) {
    return this.decode(this.stored(id).encrypted);
  }
  saveEnvironment(input: unknown, inputSecrets: unknown, revision: number) {
    const definition = EnvironmentSchema.parse(input);
    const previous = this.db.get<StoredEnvironment>('environment', definition.id);
    const secrets = previous ? this.decode(previous.encrypted) : {};
    for (const [key, value] of Object.entries(Variables.parse(inputSecrets))) {
      if (value) secrets[key] = value;
      else delete secrets[key];
    }
    this.db.save(
      'environment',
      { id: definition.id, definition, encrypted: this.encode(secrets) },
      revision,
    );
    return this.environment(definition.id);
  }
  settings() {
    return (
      this.db.get<ReturnType<typeof SettingsSchema.parse>>('settings', 'settings') ?? {
        ...SettingsSchema.parse({}),
        revision: 0,
      }
    );
  }
  saveSettings(input: unknown, revision: number) {
    return this.db.save('settings', SettingsSchema.parse(input), revision);
  }
  previews() {
    return this.db.list<Preview>('preview');
  }
  preview(id: string) {
    const value = this.db.get<Preview>('preview', id);
    if (!value) throw new WorkspaceError('Prévia não encontrada.');
    return value;
  }
  savePreview(value: Preview) {
    return this.db.save('preview', value, this.db.get<Preview>('preview', value.id)?.revision ?? 0);
  }
  saveRuntime(id: string, value: PreparedCompose) {
    this.db.save(
      'runtime',
      { id, encrypted: this.encode({ payload: JSON.stringify(value) }) },
      this.db.get('runtime', id)?.revision ?? 0,
    );
  }
  runtime(id: string): PreparedCompose | undefined {
    const value = this.db.get<{ encrypted: string }>('runtime', id);
    return value
      ? (JSON.parse(this.decode(value.encrypted).payload!) as PreparedCompose)
      : undefined;
  }
  jobs() {
    return this.db.list<Job>('job').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  redact(text: string, runtimeId?: string) {
    const values = this.environments().flatMap((environment) =>
      Object.values(this.secrets(environment.id)),
    );
    if (runtimeId) values.push(...(this.runtime(runtimeId)?.redactions ?? []));
    for (const secret of values.sort((a, b) => b.length - a.length))
      if (secret) text = text.replaceAll(secret, '[redacted]');
    return text;
  }
  job(id: string) {
    const value = this.db.get<Job>('job', id);
    if (!value) throw new WorkspaceError('Operação não encontrada.');
    return value;
  }
  saveJob(value: Job) {
    return this.db.save('job', value, this.db.get<Job>('job', value.id)?.revision ?? 0);
  }
  close() {
    this.db.close();
  }
}
