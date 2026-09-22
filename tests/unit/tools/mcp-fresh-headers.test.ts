import { describe, it, expect, vi, afterEach } from 'vitest';
import { withFreshHeaders } from '../../../src/tools/mcp-adapter.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withFreshHeaders', () => {
  // O transporte fixa requestInit uma vez, na conexao. Um Bearer de 24 horas
  // venceria no meio de uma sessao longa sem que nada reconectasse.
  it('resolves the credential on every request, not once', async () => {
    const getHeaders = vi
      .fn()
      .mockResolvedValueOnce({ Authorization: 'Bearer primeiro' })
      .mockResolvedValueOnce({ Authorization: 'Bearer segundo' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    const wrapped = withFreshHeaders(getHeaders);
    await wrapped('https://exemplo.test/mcp');
    await wrapped('https://exemplo.test/mcp');

    expect(getHeaders).toHaveBeenCalledTimes(2);
    const first = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const second = fetchSpy.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(first.Authorization).toBe('Bearer primeiro');
    expect(second.Authorization).toBe('Bearer segundo');
  });

  it('keeps the other headers the transport had set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const wrapped = withFreshHeaders(() => Promise.resolve({ Authorization: 'Bearer x' }));

    await wrapped('https://exemplo.test/mcp', {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    });

    const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Accept).toBe('text/event-stream');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBe('Bearer x');
  });

  it('lets the fresh value win over a stale one already in the init', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const wrapped = withFreshHeaders(() => Promise.resolve({ Authorization: 'Bearer novo' }));

    await wrapped('https://exemplo.test/mcp', { headers: { Authorization: 'Bearer velho' } });

    const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer novo');
  });

  it('propagates a failure to renew instead of calling with no credential', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const wrapped = withFreshHeaders(() => Promise.reject(new Error('refresh expirou')));

    await expect(wrapped('https://exemplo.test/mcp')).rejects.toThrow('refresh expirou');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
