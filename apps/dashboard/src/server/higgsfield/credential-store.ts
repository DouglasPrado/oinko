import 'server-only';
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from '@/config/env';

export interface StoredCredential {
  client_id: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  obtained_at: number;
}

export interface CredentialStatus {
  connected: boolean;
  /** Quando o access token vence. Ausente se nao ha credencial. */
  expiresAt?: number;
  path: string;
}

function credentialPath(): string {
  return resolve(env.HIGGSFIELD_CREDENTIAL_PATH);
}

/**
 * Le a credencial para dizer o estado na tela.
 *
 * So o suficiente para responder "esta ligado?" — o token em si nunca sai
 * daqui para o navegador.
 */
export function credentialStatus(): CredentialStatus {
  const path = credentialPath();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredCredential>;
    if (!parsed.access_token || !parsed.refresh_token) return { connected: false, path };
    return {
      connected: true,
      expiresAt: (parsed.obtained_at ?? 0) + (parsed.expires_in ?? 0) * 1_000,
      path,
    };
  } catch {
    return { connected: false, path };
  }
}

/**
 * Grava a credencial onde o agente le.
 *
 * Modo 600 e `chmod` depois da escrita: o `mode` do writeFileSync so vale na
 * criacao, e um arquivo que ja existisse com permissao frouxa continuaria
 * legivel para o resto da maquina.
 */
export function saveCredential(credential: StoredCredential): void {
  const path = credentialPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(credential, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}
