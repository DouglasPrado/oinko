import { describe, it, expect, vi } from 'vitest';
import { authorizeUrl, createPkce, createState, exchangeCode, registerClient } from './oauth';

const REDIRECT = 'http://localhost:3111/api/auth/higgsfield/callback';

describe('createPkce', () => {
  it('derives the challenge from the verifier with S256', async () => {
    const { verifier, challenge } = createPkce();
    const { createHash } = await import('node:crypto');

    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(verifier).not.toBe(challenge);
  });

  it('never repeats a verifier or a state', () => {
    const verifiers = new Set(Array.from({ length: 50 }, () => createPkce().verifier));
    const states = new Set(Array.from({ length: 50 }, () => createState()));
    expect(verifiers.size).toBe(50);
    expect(states.size).toBe(50);
  });
});

describe('authorizeUrl', () => {
  it('asks for offline access, which is what yields a refresh token', () => {
    const url = new URL(
      authorizeUrl({ clientId: 'c1', redirectUri: REDIRECT, challenge: 'ch', state: 'st' }),
    );

    expect(url.searchParams.get('scope')).toContain('offline_access');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
  });

  // O verifier prova que quem volta com o code e quem comecou; ele nunca vai
  // na URL, so o desafio derivado.
  it('never puts the verifier in the URL', () => {
    const { verifier, challenge } = createPkce();
    const url = authorizeUrl({ clientId: 'c1', redirectUri: REDIRECT, challenge, state: 'st' });
    expect(url).not.toContain(verifier);
  });
});

describe('registerClient', () => {
  it('registers as a public client, because the dashboard cannot keep a secret', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ client_id: 'c1' }), { status: 201 }));

    const client = await registerClient(REDIRECT, fetchImpl);

    expect(client.client_id).toBe('c1');
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as { body: string }).body) as {
      token_endpoint_auth_method: string;
      redirect_uris: string[];
    };
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(body.redirect_uris).toEqual([REDIRECT]);
  });

  it('fails loudly when the server refuses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 400 }));
    await expect(registerClient(REDIRECT, fetchImpl)).rejects.toThrow(/400/);
  });
});

describe('exchangeCode', () => {
  const params = { code: 'abc', verifier: 'v', clientId: 'c1', redirectUri: REDIRECT };

  it('sends the verifier so the server can match the challenge', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 86400 }), {
        status: 200,
      }),
    );

    const tokens = await exchangeCode(params, fetchImpl);

    expect(tokens.access_token).toBe('a');
    expect(tokens.refresh_token).toBe('r');
    const body = (fetchImpl.mock.calls[0]?.[1] as { body: URLSearchParams }).body;
    expect(body.get('code_verifier')).toBe('v');
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  // Sem refresh o agente pararia em 24 horas e alguem teria de reautorizar a
  // mao. Melhor falhar aqui, onde da para explicar.
  it('refuses a token set with no refresh token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'a', expires_in: 86400 }), { status: 200 }),
      );

    await expect(exchangeCode(params, fetchImpl)).rejects.toThrow(/refresh_token/);
  });

  it('assumes a day of validity when the server omits it', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r' }), { status: 200 }),
      );

    const tokens = await exchangeCode(params, fetchImpl);
    expect(tokens.expires_in).toBe(86_400);
  });
});
