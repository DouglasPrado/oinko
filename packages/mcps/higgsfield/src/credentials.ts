import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

const CredentialSchema = z.object({
  client_id: z.string().min(1),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  obtained_at: z.number().finite(),
});
export type HiggsfieldCredential = z.infer<typeof CredentialSchema>;
export type StoredCredential = HiggsfieldCredential;
export interface CredentialStatus {
  connected: boolean;
  expiresAt?: number;
  path: string;
}

export function readCredential(path: string): HiggsfieldCredential | undefined {
  try {
    return CredentialSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
}

export function credentialStatus(path: string): CredentialStatus {
  const credential = readCredential(path);
  return credential
    ? { connected: true, expiresAt: credential.obtained_at + credential.expires_in * 1000, path }
    : { connected: false, path };
}

/** Atomic replacement; readers never observe partial JSON. */
export function saveCredential(path: string, value: HiggsfieldCredential): void {
  const credential = CredentialSchema.parse(value);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(credential, null, 2), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      /* Renamed successfully. */
    }
  }
}

/** One lock per credential, shared by renewal and OAuth writes across processes. */
export async function withCredentialLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  const lock = `${resolve(path)}.lock`;
  mkdirSync(dirname(lock), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 40_000;
  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline)
        throw new Error('Higgsfield: tempo esgotado aguardando a credencial compartilhada.', {
          cause: error,
        });
      await delay(50);
    }
  }
  try {
    writeFileSync(`${lock}/owner`, String(process.pid), { mode: 0o600 });
    return await action();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function storeCredential(
  path: string,
  credential: HiggsfieldCredential,
): Promise<void> {
  await withCredentialLock(path, async () => {
    saveCredential(path, credential);
  });
}

export interface HeadersOptions {
  path: string;
  now?: number;
  fetch?: typeof globalThis.fetch;
}
export async function higgsfieldHeaders(options: HeadersOptions): Promise<Record<string, string>> {
  const path = resolve(options.path);
  const valid = (credential: HiggsfieldCredential) =>
    (options.now ?? Date.now()) < credential.obtained_at + credential.expires_in * 1000 - 600_000;
  const initial = readCredential(path);
  if (!initial) throw new Error('Sem credencial do Higgsfield. Abra a dashboard e autorize.');
  if (valid(initial)) return { Authorization: `Bearer ${initial.access_token}` };
  return withCredentialLock(path, async () => {
    const current = readCredential(path);
    if (!current) throw new Error('Credencial do Higgsfield indisponível.');
    if (valid(current)) return { Authorization: `Bearer ${current.access_token}` };
    const response = await (options.fetch ?? globalThis.fetch)(
      'https://clerk.higgsfield.ai/oauth/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: current.refresh_token,
          client_id: current.client_id,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      throw new Error('Higgsfield recusou a renovação. Abra a dashboard e autorize de novo.');
    const fresh = z
      .object({
        access_token: z.string().min(1),
        refresh_token: z.string().min(1).optional(),
        expires_in: z.number().positive(),
      })
      .parse(await response.json());
    const next = {
      ...current,
      ...fresh,
      refresh_token: fresh.refresh_token ?? current.refresh_token,
      obtained_at: options.now ?? Date.now(),
    };
    saveCredential(path, next);
    return { Authorization: `Bearer ${next.access_token}` };
  });
}
