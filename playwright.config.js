// playwright.config.js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // E2E tests in ./e2e directory
  // Smoke tests in root (smoke.spec.js)
  testDir: './',
  testMatch: ['**/*.spec.js'],
  
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  
  // Timeout configuration
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
    ['json', { outputFile: 'playwright-report/results.json' }]
  ],
  
  use: {
    // Use BASE_URL from environment (set by docker-compose or workflow)
    baseURL: process.env.BASE_URL || 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    
    // Increase timeouts for CI
    actionTimeout: process.env.CI ? 10000 : 5000,
    navigationTimeout: process.env.CI ? 30000 : 15000,
  },
  
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  
  // Only start webServer when NOT running in Docker (e2e tests)
  // Smoke tests run against already-running Docker container
  ...(process.env.BASE_URL ? {} : {
    webServer: {
      command: 'cd server && npm start',
      url: 'http://localhost:3001/healthz',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  }),
});