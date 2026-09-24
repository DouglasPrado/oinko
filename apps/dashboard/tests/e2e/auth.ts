import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { environmentRequest } from '@oinko/environments/client';

export const PASSWORD = 'local-test-dashboard-password';
export const test = base.extend({
  page: async ({ page, baseURL }, use, testInfo) => {
    const headers = { origin: baseURL! };
    await page.request.post('/api/session', { headers, data: { password: PASSWORD, setup: true } });
    const login = await page.request.post('/api/session', {
      headers,
      data: { password: PASSWORD },
    });
    expect(login.ok()).toBe(true);
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus && process.env.OINKO_E2E_ROOT) {
      const root = process.env.OINKO_E2E_ROOT;
      const health = await environmentRequest(root, '/health', undefined, 1000).catch(
        (error: Error) => ({ error: error.message }),
      );
      await testInfo.attach('runner-health', {
        body: JSON.stringify(health),
        contentType: 'application/json',
      });
      for (const name of ['runner-process.log', 'runner-error.log']) {
        const log = await readFile(join(root, '.harness/runtime', name)).catch(() => undefined);
        if (log)
          await testInfo.attach(name, { body: log.subarray(-65_536), contentType: 'text/plain' });
      }
    }
  },
});
export { expect };
