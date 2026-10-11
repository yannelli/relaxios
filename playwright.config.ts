import { defineConfig, devices } from '@playwright/test';

// Needs `npm run build` first: the test page loads dist/ through an import map.
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '*.spec.ts',
  timeout: 30_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'node test/e2e/server.ts',
    url: 'http://localhost:4173/health',
    reuseExistingServer: !process.env.CI,
  },
});
