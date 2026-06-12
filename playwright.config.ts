import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config.
 *
 * - Local (default): starts the worker (wrangler) + web (vite) dev servers and
 *   tests http://localhost:5173.
 * - Against a deployment: set E2E_BASE_URL (e.g. the *.workers.dev URL) and the
 *   suite runs against that origin with NO local servers started. Used by the
 *   post-deploy production-e2e workflow.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const useLocalServers = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(useLocalServers
    ? {
        webServer: [
          {
            command: 'pnpm --filter @ek/worker dev',
            port: 8787,
            reuseExistingServer: true,
            timeout: 60_000,
          },
          {
            command: 'pnpm --filter @ek/web dev',
            port: 5173,
            reuseExistingServer: true,
            timeout: 60_000,
          },
        ],
      }
    : {}),
});
