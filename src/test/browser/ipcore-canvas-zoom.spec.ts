import { expect, test, type Page } from '@playwright/test';
import path from 'path';

const harnessPath = `file://${path.resolve(__dirname, 'ipcore.html')}`;
const ipCoreYaml = `
vlnv:
  vendor: test.com
  library: smoke
  name: zoom_indicator_core
  version: 1.0.0
`;

async function setupIpCore(page: Page): Promise<void> {
  const readyPromise = page.waitForEvent('console', {
    predicate: (message) =>
      message.text().includes('VSCODE_MESSAGE:') && message.text().includes('"ready"'),
    timeout: 10000,
  });

  await page.goto(harnessPath);
  await page.waitForSelector('#ipcore-root');
  await readyPromise;
  await page.evaluate((yaml) => {
    window.postMessage({ type: 'update', text: yaml, fileName: 'zoom_indicator_core.ip.yml' }, '*');
  }, ipCoreYaml);
  await expect(page.locator('.ip-canvas-container')).toBeVisible();
}

test('keeps the zoom percentage visible throughout a continuous zoom gesture', async ({ page }) => {
  await setupIpCore(page);

  const canvas = page.locator('.ip-canvas-container');
  const indicator = page.locator('.ip-canvas-zoom-indicator');

  await canvas.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 });
  await expect(indicator).toBeVisible();

  await page.waitForTimeout(1000);
  await canvas.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 });
  await page.waitForTimeout(600);

  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveCSS('opacity', '0.9');
  await expect(indicator).toBeHidden({ timeout: 2000 });
});
