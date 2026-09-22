import { defineConfig, devices } from '@playwright/test';

const PORT = 3112;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: BASE_URL, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // build && start, nunca dev: a compilacao sob demanda do dev torna a
    // primeira navegacao instavel e e a origem classica de flake.
    command: `pnpm build && pnpm exec next start -H 127.0.0.1 -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { TELEMETRY_DB_PATH: '../../.harness/telemetry.db' },
  },
});
