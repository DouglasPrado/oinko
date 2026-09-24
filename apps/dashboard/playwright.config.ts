import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

process.env.OINKO_E2E_ROOT ??= mkdtempSync(join(tmpdir(), 'oinko-e2e-'));
const testRoot = process.env.OINKO_E2E_ROOT;
const PORT = 3112;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  globalTeardown: './tests/e2e/cleanup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure', actionTimeout: 20_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // build && start, nunca dev: a compilacao sob demanda do dev torna a
    // primeira navegacao instavel e e a origem classica de flake.
    command: `pnpm -w build:packages && node scripts/seed-telemetry.mjs && node scripts/seed-programming.mjs && pnpm build && pnpm exec next start -H 127.0.0.1 -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      TELEMETRY_DB_PATH: join(testRoot, 'telemetry.db'),
      OINKO_ROOT: testRoot,
      OINKO_NEXT_DIST_DIR: '.next-e2e',
    },
  },
});
