import { defineConfig, devices } from '@playwright/test';

// Separate from playwright.config.ts on purpose: npm run test:browser and CI
// must never run the performance script. See docs/concepts/docs-screenshots.md.
export default defineConfig({
  testDir: '../scripts/perf',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
  },
  outputDir: '../test-results/perf-artifacts',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
