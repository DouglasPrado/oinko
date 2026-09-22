import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

const AUTHORIZATION_SERVER = 'https://clerk.higgsfield.ai';
/** `offline_access` e o que faz o servidor devolver refresh token. */
const SCOPE = 'openid email offline_access';

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/**
 * Par PKCE.
 *
 * O cliente e publico — o servidor registra com `token_endpoint_auth_method:
 * none` —, entao o PKCE e o que impede alguem que intercepte o code de troca-lo
 * por um token.
 */
export function createPkce(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function createState(): string {
  return randomBytes(16).toString('base64url');
}

export interface RegisteredClient {
  client_id: string;
}

/**
 * Registra a dashboard como cliente OAuth.
 *
 * O servidor aceita registro dinamico, entao nao ha app para criar em painel
 * nenhum: o cliente nasce na primeira autorizacao e o id fica guardado com a
 * credencial, porque a renovacao precisa dele.
 */
export async function registerClient(
  redirectUri: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<RegisteredClient> {
  const response = await fetchImpl(`${AUTHORIZATION_SERVER}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'oinko-dashboard',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPE,
    }),
  });

  if (!response.ok) {
    throw new Error(`Registro do cliente falhou: ${response.status}`);
  }

  const client = (await response.json()) as { client_id?: string };
  if (!client.client_id) throw new Error('Registro do cliente nao devolveu client_id');
  return { client_id: client.client_id };
}

export function authorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL(`${AUTHORIZATION_SERVER}/oauth/authorize`);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('code_challenge', params.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', params.state);
  return url.toString();
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export async function exchangeCode(
  params: { code: string; verifier: string; clientId: string; redirectUri: string },
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<TokenSet> {
  const response = await fetchImpl(`${AUTHORIZATION_SERVER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      code_verifier: params.verifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`Troca do code falhou: ${response.status}`);
  }

  const tokens = (await response.json()) as Partial<TokenSet>;
  if (!tokens.access_token) throw new Error('Resposta sem access_token');
  if (!tokens.refresh_token) {
    // Sem refresh o bot pararia em 24 horas e alguem teria de reautorizar a
    // mao. Melhor falhar aqui, onde da para explicar, que descobrir depois.
    throw new Error('Resposta sem refresh_token: o bot nao conseguiria renovar sozinho');
  }

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in ?? 86_400,
  };
}
