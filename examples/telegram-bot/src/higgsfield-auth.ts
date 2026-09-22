import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Onde a dashboard grava e o bot le. O formato e o contrato entre os dois. */
export const CREDENTIAL_PATH = join(process.cwd(), '.harness', 'credentials', 'higgsfield.json');

const TOKEN_ENDPOINT = 'https://clerk.higgsfield.ai/oauth/token';
/** Renova com folga: esperar o vencimento abriria uma janela de 401 em pleno turno. */
const RENEW_BEFORE_MS = 10 * 60_000;

export interface HiggsfieldCredential {
  client_id: string;
  access_token: string;
  refresh_token: string;
  /** Segundos de validade do access, como o servidor informou. */
  expires_in: number;
  /** Quando esta credencial foi obtida ou renovada. */
  obtained_at: number;
}

export interface HeadersOptions {
  path?: string;
  now?: number;
  fetch?: typeof globalThis.fetch;
}

/** Renovacao em voo, para dois turnos simultaneos nao rotacionarem o refresh duas vezes. */
let renewing: Promise<HiggsfieldCredential> | null = null;

export function readCredential(path: string): HiggsfieldCredential | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<HiggsfieldCredential>;
    if (typeof parsed.access_token !== 'string' || typeof parsed.refresh_token !== 'string') {
      return undefined;
    }
    return parsed as HiggsfieldCredential;
  } catch {
    // Ausente, ilegivel ou corrompido — quem chama decide o que dizer.
    return undefined;
  }
}

function save(path: string, credential: HiggsfieldCredential): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(credential, null, 2), { mode: 0o600 });
  // `mode` no writeFileSync so vale na criacao: um arquivo que ja existia com
  // permissao frouxa continuaria legivel para o resto da maquina.
  chmodSync(path, 0o600);
}

function expiresAt(credential: HiggsfieldCredential): number {
  return credential.obtained_at + credential.expires_in * 1_000;
}

async function renew(
  credential: HiggsfieldCredential,
  path: string,
  now: number,
  fetchImpl: typeof globalThis.fetch,
): Promise<HiggsfieldCredential> {
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credential.refresh_token,
      client_id: credential.client_id,
    }),
  });

  if (!response.ok) {
    throw new Error(
      'Higgsfield recusou a renovacao da credencial. Abra a dashboard e autorize de novo.',
    );
  }

  const fresh = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const next: HiggsfieldCredential = {
    client_id: credential.client_id,
    access_token: fresh.access_token,
    // O servidor rotaciona o refresh a cada uso: o anterior morre na hora, e
    // nao gravar o novo custaria o acesso na renovacao seguinte.
    refresh_token: fresh.refresh_token ?? credential.refresh_token,
    expires_in: fresh.expires_in,
    obtained_at: now,
  };

  save(path, next);
  return next;
}

/**
 * Cabecalho de autorizacao do Higgsfield, sempre valido.
 *
 * Passado ao MCP como `getHeaders`, entao roda a cada requisicao: le a
 * credencial que a dashboard gravou e renova antes de vencer. A renovacao em
 * voo e compartilhada porque o refresh e rotacionado — dois turnos renovando em
 * paralelo derrubariam um ao outro.
 */
export async function higgsfieldHeaders(
  options: HeadersOptions = {},
): Promise<Record<string, string>> {
  const path = options.path ?? CREDENTIAL_PATH;
  const now = options.now ?? Date.now();
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const credential = readCredential(path);
  if (!credential) {
    throw new Error(
      `Sem credencial do Higgsfield em ${path}. Abra a dashboard e conclua a autorizacao.`,
    );
  }

  if (now < expiresAt(credential) - RENEW_BEFORE_MS) {
    return { Authorization: `Bearer ${credential.access_token}` };
  }

  renewing ??= renew(credential, path, now, fetchImpl).finally(() => {
    renewing = null;
  });

  const fresh = await renewing;
  return { Authorization: `Bearer ${fresh.access_token}` };
}
