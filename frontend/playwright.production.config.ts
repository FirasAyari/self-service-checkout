import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e-production',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  outputDir: 'test-results/production-artifacts',
  reporter: process.env.CI
    ? [['list'], ['json', { outputFile: 'test-results/production-results.json' }]]
    : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    // The checkout has no payment credential fields; traces stay disabled for kiosk privacy.
    trace: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium-production', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../scripts/run-production-api.mjs',
    url: 'http://127.0.0.1:4174/health/live',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
