import { test as base, expect } from '@playwright/test';

export const PASSWORD = 'local-test-dashboard-password';
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const headers = { origin: baseURL! };
    await page.request.post('/api/session', { headers, data: { password: PASSWORD, setup: true } });
    const login = await page.request.post('/api/session', {
      headers,
      data: { password: PASSWORD },
    });
    expect(login.ok()).toBe(true);
    await use(page);
  },
});
export { expect };
