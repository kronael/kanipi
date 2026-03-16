import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/playwright',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:9876',
    headless: true,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npx tsx tests/playwright/server.ts',
    url: 'http://localhost:9876/dash/',
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
});
