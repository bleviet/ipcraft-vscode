/* eslint-disable */
// Regression coverage for GitHub issue #99 (comment
// https://github.com/bleviet/ipcraft-vscode/issues/99#issuecomment-4998256496):
// on a narrow editor width, the Fields table's Access/Reset/Description
// columns were being squeezed into unreadable slivers instead of the table
// scrolling horizontally, because (a) `<col min-w-[...]>` is decorative and
// ignored under `table-layout: fixed`, and (b) a flex wrapper around the
// table was missing `min-w-0`, so it refused to shrink below the table's
// content width instead of clipping it for scroll. jsdom doesn't compute
// real layout, so this needs an actual browser.
import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Fields table at narrow editor width (issue #99)', () => {
  const harnessPath = `file://${path.resolve(__dirname, 'index.html')}`;

  const yaml = `
addressBlocks:
  - name: GLOBAL_REGS
    baseAddress: 0
    registers:
      - name: GLOBAL_CTRL
        addressOffset: 0
        size: 32
        description: Global control register
        fields:
          - name: ENABLE_ALL
            bits: "[0:0]"
            access: read-write
            resetValue: 0
            description: Enables all channels simultaneously
`;

  test.beforeEach(async ({ page }) => {
    const readyPromise = page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('VSCODE_MESSAGE:') && msg.text().includes('"ready"'),
      timeout: 10000,
    });

    // A realistic "half a laptop screen" editor width — narrow enough that
    // the fixed-width bit-field visualizer pane leaves the fields table too
    // little room to fit all columns comfortably.
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto(harnessPath);
    await page.waitForSelector('#root div');
    await readyPromise;

    await page.evaluate((y) => {
      const send = () =>
        (window as any).__RENDER__
          ? (window as any).__RENDER__(y)
          : window.postMessage({ type: 'update', text: y }, '*');
      send();
    }, yaml);

    await page.waitForSelector('#root main', { timeout: 15000 });

    const ctrlItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await ctrlItem.click();
    await expect(page.locator('td[data-col-key="name"] input').first()).toHaveValue('ENABLE_ALL', {
      timeout: 5000,
    });
  });

  test('scrolls horizontally instead of squeezing columns unreadably', async ({ page }) => {
    const scrollContainer = page.locator('[data-fields-table="true"]');

    const { clientWidth, scrollWidth } = await scrollContainer.evaluate((el) => ({
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
    }));

    expect(scrollWidth).toBeGreaterThan(clientWidth);
    expect(scrollWidth).toBeGreaterThanOrEqual(700);
  });

  test('the Name and Bit(s) columns do not visually overlap', async ({ page }) => {
    const nameCell = page.locator('td[data-col-key="name"]').first();
    const bitsCell = page.locator('td[data-col-key="bits"]').first();

    const nameBox = await nameCell.boundingBox();
    const bitsBox = await bitsCell.boundingBox();

    expect(nameBox).not.toBeNull();
    expect(bitsBox).not.toBeNull();
    // The Bit(s) cell must start at or after where the Name cell ends.
    expect(bitsBox!.x).toBeGreaterThanOrEqual(nameBox!.x + nameBox!.width - 1);
  });

  test('scrolling to the end reveals the Description column fully', async ({ page }) => {
    const scrollContainer = page.locator('[data-fields-table="true"]');
    await scrollContainer.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });

    await expect(page.locator('th', { hasText: 'Description' })).toBeVisible();
  });
});
