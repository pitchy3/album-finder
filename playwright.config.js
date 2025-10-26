import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list']
  ],
  
  use: {
    // Use BASE_URL from environment (set by docker-compose)
    baseURL: process.env.BASE_URL || 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  
  // Only start webServer when NOT running in Docker
  ...(process.env.BASE_URL ? {} : {
    webServer: {
      command: 'npm run test:server',
      url: 'http://localhost:3001/healthz',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  }),
});