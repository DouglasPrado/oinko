import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  higgsfieldHeaders,
  readCredential,
  type HiggsfieldCredential,
} from '../../../../examples/telegram-bot/src/higgsfield-auth.js';

let dir: string;
let path: string;

const HOUR = 3_600_000;
const NOW = 1_000 * HOUR;

function save(credential: Partial<HiggsfieldCredential>): void {
  writeFileSync(
    path,
    JSON.stringify({
      client_id: 'client-1',
      access_token: 'access-velho',
      refresh_token: 'refresh-velho',
      expires_in: 86_400,
      obtained_at: NOW,
      ...credential,
    }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hf-auth-'));
  path = join(dir, 'higgsfield.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('higgsfieldHeaders', () => {
  it('uses the stored token while it is still valid', async () => {
    save({});
    const fetchSpy = vi.fn();

    const headers = await higgsfieldHeaders({ path, now: NOW + HOUR, fetch: fetchSpy });

    expect(headers.Authorization).toBe('Bearer access-velho');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // O token dura 24h. Renovar so depois de expirar deixaria uma janela em que
  // o servidor responde 401 no meio de um turno.
  it('renews before the token actually expires', async () => {
    save({});
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'access-novo',
          refresh_token: 'refresh-novo',
          expires_in: 86_400,
        }),
        { status: 200 },
      ),
    );

    const headers = await higgsfieldHeaders({ path, now: NOW + 23.9 * HOUR, fetch: fetchSpy });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(headers.Authorization).toBe('Bearer access-novo');
  });

  // O servidor rotaciona o refresh a cada uso: o anterior morre na hora. Nao
  // gravar o novo significa perder o acesso de vez na renovacao seguinte.
  it('persists the rotated refresh token immediately', async () => {
    save({});
    vi.fn();
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'access-novo',
          refresh_token: 'refresh-novo',
          expires_in: 86_400,
        }),
        { status: 200 },
      ),
    );

    await higgsfieldHeaders({ path, now: NOW + 24 * HOUR, fetch: fetchSpy });

    const saved = JSON.parse(readFileSync(path, 'utf8')) as HiggsfieldCredential;
    expect(saved.refresh_token).toBe('refresh-novo');
    expect(saved.access_token).toBe('access-novo');
  });

  it('renews only once when two turns ask at the same time', async () => {
    save({});
    const fetchSpy = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                new Response(
                  JSON.stringify({
                    access_token: 'access-novo',
                    refresh_token: 'refresh-novo',
                    expires_in: 86_400,
                  }),
                  { status: 200 },
                ),
              ),
            10,
          ),
        ),
    );

    // Duas renovacoes em paralelo derrubariam uma a outra: a primeira rotaciona
    // o refresh e a segunda tentaria usar o que ja morreu.
    const [a, b] = await Promise.all([
      higgsfieldHeaders({ path, now: NOW + 24 * HOUR, fetch: fetchSpy }),
      higgsfieldHeaders({ path, now: NOW + 24 * HOUR, fetch: fetchSpy }),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(a.Authorization).toBe(b.Authorization);
  });

  it('says what to do when there is no credential yet', async () => {
    await expect(higgsfieldHeaders({ path, now: NOW })).rejects.toThrow(/dashboard/i);
  });

  it('says what to do when the refresh itself is refused', async () => {
    save({});
    const fetchSpy = vi.fn().mockResolvedValue(new Response('invalid_grant', { status: 400 }));

    await expect(
      higgsfieldHeaders({ path, now: NOW + 24 * HOUR, fetch: fetchSpy }),
    ).rejects.toThrow(/autorize de novo/i);
  });

  it('writes the file so only the owner can read it', async () => {
    save({});
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 10 }),
        { status: 200 },
      ),
    );

    await higgsfieldHeaders({ path, now: NOW + 24 * HOUR, fetch: fetchSpy });

    // Credencial de servico pago nao fica legivel para o resto da maquina.
    expect(statSync(path).mode & 0o077).toBe(0);
  });
});

describe('readCredential', () => {
  it('returns undefined when the file is absent or unreadable', () => {
    expect(readCredential(join(dir, 'nao-existe.json'))).toBeUndefined();
    writeFileSync(path, 'nao e json');
    expect(readCredential(path)).toBeUndefined();
  });
});
