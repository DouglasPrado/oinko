// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { DashboardAuth } from './auth';

it('hashes the password, rejects invalid sessions and invalidates expired sessions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dashboard-auth-'));
  const auth = new DashboardAuth(root);
  try {
    expect(auth.configured()).toBe(false);
    await auth.setup('uma-senha-de-teste-segura');
    expect(auth.configured()).toBe(true);
    expect(readFileSync(join(root, '.harness/dashboard-auth.json'), 'utf8')).not.toContain(
      'uma-senha-de-teste-segura',
    );
    expect(await auth.login('errada')).toBeNull();
    const token = await auth.login('uma-senha-de-teste-segura');
    expect(auth.verify(token!)).toBe(true);
    expect(auth.verify(`${token!}x`)).toBe(false);
    expect(auth.verify('forged')).toBe(false);
    expect(auth.verify(token!, Date.now() + 8 * 24 * 3600 * 1000)).toBe(false);
    await expect(auth.setup('outra-senha-segura')).rejects.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
