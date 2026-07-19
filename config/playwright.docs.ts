import { defineConfig, devices } from '@playwright/test';

// Separate from playwright.config.ts (testDir: src/test/browser) on purpose:
// npm run test:browser must stay untouched by this, and CI must not
// generate docs images on every PR. See docs/concepts/docs-screenshots.md.
export default defineConfig({
  testDir: '../scripts/docs-screenshots',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    deviceScaleFactor: 2,
  },
  outputDir: '../test-results/docs-screenshots',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
