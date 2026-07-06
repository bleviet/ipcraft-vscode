/* eslint-disable */
// Regression coverage for GitHub issue #39: playing with a register's bit
// values to see which bits are set must not silently rewrite the .mm.yml
// file. Debug Mode lets the user explore reset values (bit clicks / typed
// values) without any of it reaching the document, and discards the
// exploration the moment it's switched off.
import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Debug Mode for register value exploration (issue #39)', () => {
  const harnessPath = `file://${path.resolve(__dirname, 'index.html')}`;

  const yaml = `
addressBlocks:
  - name: REGS
    baseAddress: 0
    registers:
      - name: CTRL
        addressOffset: 0
        size: 4
        fields:
          - name: ENABLE
            bits: "[0:0]"
            resetValue: 0
`;

  test.beforeEach(async ({ page }) => {
    const readyPromise = page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('VSCODE_MESSAGE:') && msg.text().includes('"ready"'),
      timeout: 10000,
    });

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
    await expect(page.locator('td[data-col-key="name"] input').first()).toHaveValue('ENABLE', {
      timeout: 5000,
    });
  });

  function enableBitCell(page: import('@playwright/test').Page) {
    return page
      .getByRole('button', { name: /ENABLE bits/ })
      .locator('.touch-none')
      .first();
  }

  test('by default, clicking a bit writes the new reset value to the document', async ({
    page,
  }) => {
    await page.evaluate(() => {
      (window as any).__last_message = null;
    });

    await enableBitCell(page).click();

    await page.waitForFunction(
      () => {
        const msg = (window as any).__last_message;
        return msg && msg.type === 'update';
      },
      { timeout: 10000 }
    );

    const lastMsg = await page.evaluate(() => (window as any).__last_message);
    expect(lastMsg.type).toBe('update');
    expect(lastMsg.text).toContain('resetValue: 1');
  });

  test('Debug Mode blocks the write but still toggles the bit visually, and discards on exit', async ({
    page,
  }) => {
    const debugToggle = page.locator('button[aria-label="Toggle Debug Mode"]');
    await debugToggle.click();
    await expect(page.locator('text=Debug Mode')).toBeVisible();

    const bitCell = enableBitCell(page);
    await expect(bitCell.locator('span')).toHaveText('0');

    await page.evaluate(() => {
      (window as any).__last_message = null;
    });

    await bitCell.click();

    // The bit flips locally for exploration...
    await expect(bitCell.locator('span')).toHaveText('1');

    // ...but nothing was written to the document.
    await page.waitForTimeout(500);
    const msgDuringDebug = await page.evaluate(() => (window as any).__last_message);
    expect(msgDuringDebug).toBeNull();

    // Leaving Debug Mode discards the exploration value; the real
    // (never-persisted) reset value of 0 comes back.
    await debugToggle.click();
    await expect(page.locator('text=Debug Mode')).not.toBeVisible();
    await expect(bitCell.locator('span')).toHaveText('0');
  });
});
