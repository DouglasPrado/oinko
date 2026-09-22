import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { saveCredential } from '../src/credentials.js';

it('renews a shared credential only once across independent Node processes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'higgsfield-processes-'));
  const path = join(dir, 'credential.json');
  const calls = join(dir, 'calls');
  saveCredential(path, {
    client_id: 'client',
    access_token: 'expired',
    refresh_token: 'old',
    expires_in: 1,
    obtained_at: 0,
  });
  const code = `
    import { higgsfieldHeaders } from ${JSON.stringify(new URL('../dist/credentials.js', import.meta.url).href)};
    import { appendFileSync } from 'node:fs';
    const headers = await higgsfieldHeaders({ path: ${JSON.stringify(path)}, fetch: async () => {
      appendFileSync(${JSON.stringify(calls)}, 'refresh\\n');
      await new Promise(resolve => setTimeout(resolve, 100));
      return new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'rotated', expires_in: 3600 }));
    }});
    if (headers.Authorization !== 'Bearer fresh') process.exitCode = 1;
  `;
  try {
    await Promise.all(
      [1, 2, 3].map(() =>
        promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], {
          timeout: 10000,
        }),
      ),
    );
    expect(readFileSync(calls, 'utf8')).toBe('refresh\n');
    expect(JSON.parse(readFileSync(path, 'utf8')).refresh_token).toBe('rotated');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
