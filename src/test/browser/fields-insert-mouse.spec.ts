/* eslint-disable */
// Regression coverage for GitHub issue #235: adding a bit field must be
// discoverable with the mouse. A hover (+) bar between rows (only where free
// bits exist) and a right-click Insert Above/Below menu. Needs real layout
// for the hover geometry, so this runs in a browser.
import { test, expect, type Locator, type Page } from '@playwright/test';
import path from 'path';

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
          - name: LOW
            bits: "[0:0]"
            access: read-write
            resetValue: 0
          - name: MID
            bits: "[7:4]"
            access: read-write
            resetValue: 0
          - name: NEXT
            bits: "[8:8]"
            access: read-write
            resetValue: 0
`;

// The Bit(s) cell is an MSB input and an LSB input.
async function expectBit1(row: Locator) {
  await expect(row.locator('td[data-col-key="bits"] input[placeholder="MSB"]')).toHaveValue('1');
  await expect(row.locator('td[data-col-key="bits"] input[placeholder="LSB"]')).toHaveValue('1');
}

async function hoverGap(page: Page, gap: number) {
  const rows = page.locator('[data-fields-table="true"] tbody tr[data-row-idx]');
  const box = gap === 0 ? await rows.nth(0).boundingBox() : await rows.nth(gap - 1).boundingBox();
  expect(box).not.toBeNull();
  const y = gap === 0 ? box!.y : box!.y + box!.height;
  await page.mouse.move(box!.x + 80, y - 6);
  await page.mouse.move(box!.x + 80, y);
}

test.describe('Mouse insertion of bit fields (issue #235)', () => {
  test.beforeEach(async ({ page }) => {
    const readyPromise = page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('VSCODE_MESSAGE:') && msg.text().includes('"ready"'),
      timeout: 10000,
    });

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto(harnessPath);
    await page.waitForSelector('#root div');
    await readyPromise;

    await page.evaluate((y) => {
      (window as any).__RENDER__
        ? (window as any).__RENDER__(y)
        : window.postMessage({ type: 'update', text: y }, '*');
    }, yaml);

    await page.waitForSelector('#root main', { timeout: 15000 });
    await page.locator('[data-outline-id="block-0-reg-0"]').click();
    await expect(page.locator('td[data-col-key="name"] input').first()).toHaveValue('LOW', {
      timeout: 5000,
    });
  });

  test('hovering a gap with free bits shows the (+) and clicking it adds a focused field', async ({
    page,
  }) => {
    await hoverGap(page, 1);
    const plus = page.getByTitle('Insert field at position 1');
    await expect(plus).toBeVisible();
    await plus.click();

    const rows = page.locator('[data-fields-table="true"] tbody tr[data-row-idx]');
    await expect(rows).toHaveCount(4);
    const newInput = rows.nth(1).locator('td[data-col-key="name"] input');
    await expect(newInput).toBeFocused();
    await expectBit1(rows.nth(1));
  });

  test('hovering the gap between adjacent fields shows no (+)', async ({ page }) => {
    await hoverGap(page, 2);
    await page.waitForTimeout(200);
    await expect(page.getByTitle(/Insert field at position/)).toHaveCount(0);
  });

  test('right-click Insert Below adds a field after the row', async ({ page }) => {
    const rows = page.locator('[data-fields-table="true"] tbody tr[data-row-idx]');
    await rows.nth(0).click({ button: 'right', position: { x: 60, y: 10 } });
    await page.getByText('Insert Below').click();

    await expect(rows).toHaveCount(4);
    await expectBit1(rows.nth(1));
  });
});
