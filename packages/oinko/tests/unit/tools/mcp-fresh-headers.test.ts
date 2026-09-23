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
    const first = fetchSpy.mock.calls[0]?.[1]?.headers as Headers;
    const second = fetchSpy.mock.calls[1]?.[1]?.headers as Headers;
    expect(first.get('authorization')).toBe('Bearer primeiro');
    expect(second.get('authorization')).toBe('Bearer segundo');
  });

  it('keeps the other headers the transport had set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const wrapped = withFreshHeaders(() => Promise.resolve({ Authorization: 'Bearer x' }));

    await wrapped('https://exemplo.test/mcp', {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    });

    const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('accept')).toBe('text/event-stream');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer x');
  });

  it('lets the fresh value win over a stale one already in the init', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const wrapped = withFreshHeaders(() => Promise.resolve({ Authorization: 'Bearer novo' }));

    await wrapped('https://exemplo.test/mcp', { headers: { Authorization: 'Bearer velho' } });

    const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer novo');
  });

  // O transporte do MCP passa uma instancia de Headers. Espalhar um objeto
  // desses com `...` produz `{}`: o Content-Type sumia e o servidor respondia
  // "Unsupported Media Type".
  it('preserves headers given as a Headers instance, not a plain object', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const wrapped = withFreshHeaders(() => Promise.resolve({ Authorization: 'Bearer x' }));

    await wrapped('https://exemplo.test/mcp', {
      headers: new Headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
    });

    const sent = fetchSpy.mock.calls[0]?.[1]?.headers as Headers;
    expect(sent.get('content-type')).toBe('application/json');
    expect(sent.get('accept')).toBe('text/event-stream');
    expect(sent.get('authorization')).toBe('Bearer x');
  });

  it('propagates a failure to renew instead of calling with no credential', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const wrapped = withFreshHeaders(() => Promise.reject(new Error('refresh expirou')));

    await expect(wrapped('https://exemplo.test/mcp')).rejects.toThrow('refresh expirou');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
