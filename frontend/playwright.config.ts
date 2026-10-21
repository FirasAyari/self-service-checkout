import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  outputDir: 'test-results/e2e-artifacts',
  reporter: process.env.CI
    ? [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]]
    : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // Browser tests enter generated demo-only values. Do not capture form contents in traces or screenshots.
    trace: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
