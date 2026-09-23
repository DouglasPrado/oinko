// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { localAccess, botResponse } from './access';
import { z } from 'zod';

describe('local bot administration', () => {
  it('requires matching localhost host and origin for writes', () => {
    expect(
      localAccess(new Headers({ host: '127.0.0.1:3111', origin: 'http://127.0.0.1:3111' }), true),
    ).toBe(true);
    const denied: Record<string, string>[] = [
      { host: '127.0.0.1:3111' },
      { host: '127.0.0.1:3111', origin: 'https://evil.example' },
      { host: 'evil.example', origin: 'https://evil.example' },
      { host: '127.0.0.1:3111', origin: 'http://127.0.0.1:3000' },
      { host: '127.0.0.1:3111', 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of denied) expect(localAccess(new Headers(headers), true)).toBe(false);
  });
  it('does not echo secrets in validation or unexpected errors', async () => {
    expect(await botResponse(new Error('secret-token')).text()).not.toContain('secret-token');
    const invalid = z.object({ token: z.number() }).safeParse({ token: 'secret-token' });
    expect(await botResponse(invalid.error).text()).not.toContain('secret-token');
  });
});
