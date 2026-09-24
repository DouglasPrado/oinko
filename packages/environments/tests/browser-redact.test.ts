import { describe, expect, it } from 'vitest';
import { Redactor, isSensitiveField } from '../src/browser/redact.js';

describe('Redactor', () => {
  const redactor = new Redactor(['qa-user@example.com', 'S3nh@-Secreta!', 'abc']);

  it('removes planted credential values, longest first, and ignores values too short to be safe', () => {
    const text = redactor.text('login qa-user@example.com with S3nh@-Secreta! abc');
    expect(text).not.toContain('qa-user@example.com');
    expect(text).not.toContain('S3nh@-Secreta!');
    expect(text).toContain('abc');
    expect(text).toContain('[redacted]');
  });

  it('removes cookies, Authorization, Set-Cookie, bearer/basic tokens, JWTs and sensitive key=value pairs', () => {
    const cases = [
      'Authorization: Bearer abc.def.ghi-token',
      'proxy-authorization=Basic dXNlcjpwYXNzd29yZA==',
      'Cookie: sid=abcdef; theme=dark',
      'set-cookie: session=zzz; HttpOnly',
      'sending Bearer tok_1234567890',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlLXZhbHVl',
      'password=hunter22 token: "t-99887766" api_key=AKIA000000 client_secret=xyzxyz',
      '{"password":"hunter22","refresh_token":"r-123456"}',
    ];
    const joined = cases.map((line) => redactor.text(line)).join('\n');
    for (const secret of [
      'abc.def.ghi-token',
      'dXNlcjpwYXNzd29yZA==',
      'sid=abcdef',
      'session=zzz',
      'tok_1234567890',
      'eyJhbGciOiJIUzI1NiJ9',
      'hunter22',
      't-99887766',
      'AKIA000000',
      'xyzxyz',
      'r-123456',
    ])
      expect(joined).not.toContain(secret);
  });

  it('keeps the credential marker readable (name only, no key:value shape)', () => {
    expect(redactor.text('[credential qa]')).toBe('[credential qa]');
  });

  it('bounds text with an explicit truncation marker', () => {
    const text = redactor.text('x'.repeat(5000), 100);
    expect(text.length).toBeLessThanOrEqual(120);
    expect(text).toMatch(/…\[truncado \d+\]$/);
  });

  it('strips userinfo, fragments and sensitive query values from URLs', () => {
    const url = redactor.url(
      'https://user:pw@app.example.com/cb?code=abc123&state=ok&access_token=zz9&page=2#id_token=eyJx',
    );
    expect(url).toBe(
      'https://app.example.com/cb?code=%5Bredacted%5D&state=ok&access_token=%5Bredacted%5D&page=2',
    );
    expect(redactor.url('https://app.example.com/?email=qa-user@example.com')).not.toContain(
      'qa-user@example.com',
    );
    expect(redactor.url('not a url')).toBe('not a url');
    expect(redactor.url(`https://x.example/${'a'.repeat(1000)}`).length).toBeLessThanOrEqual(520);
  });

  it('reports origins without paths', () => {
    expect(redactor.origin('https://App.example.com:8443/a/b?c=d')).toBe(
      'https://app.example.com:8443',
    );
    expect(redactor.origin('about:blank')).toBe('about:blank');
  });
});

describe('isSensitiveField', () => {
  it.each([
    [{ type: 'password' }, true],
    [{ type: 'text', name: 'user_password' }, true],
    [{ type: 'text', id: 'apiKey' }, true],
    [{ type: 'text', name: 'otp' }, true],
    [{ type: 'text', autocomplete: 'one-time-code' }, true],
    [{ type: 'text', autocomplete: 'cc-number' }, true],
    [{ type: 'text', name: 'csrf_token' }, true],
    [{ type: 'text', name: 'client-secret' }, true],
    [{ type: 'email', name: 'email' }, false],
    [{ type: 'text', name: 'title' }, false],
    [{ type: 'search', name: 'q' }, false],
  ])('%j → %s', (field, expected) => {
    expect(isSensitiveField(field)).toBe(expected);
  });
});
