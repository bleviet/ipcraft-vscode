/* eslint-disable */
// Verifies issue #36 Part B's Debug-Mode-integrated live-value display:
// clicking "Read from hardware" posts a readRegister message, and a
// liveValues reply from the extension host (simulated here) populates the
// register header badge and decodes into the bit-field/table display —
// all without ever going through the document update/revision protocol.
import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Live hardware register values in Debug Mode (issue #36)', () => {
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
          - name: MODE
            bits: "[3:1]"
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
      (window as any).__RENDER__(y);
    }, yaml);

    await page.waitForSelector('#root main', { timeout: 15000 });

    const ctrlItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await ctrlItem.click();
    await expect(page.locator('td[data-col-key="name"] input').first()).toHaveValue('ENABLE', {
      timeout: 5000,
    });

    // Live-value badge only renders in Debug Mode.
    await page.locator('button[aria-label="Toggle Debug Mode"]').click();
    await expect(page.locator('text=Debug Mode')).toBeVisible();
  });

  test('the read button posts readRegister, and a liveValues reply shows the value', async ({
    page,
  }) => {
    const readButton = page.locator('button[aria-label="Read CTRL from hardware"]');
    await expect(readButton).toBeVisible();
    await expect(page.locator('text=Not read from hardware')).toBeVisible();

    await page.evaluate(() => {
      (window as any).__last_message = null;
    });

    await readButton.click();

    await expect(page.locator('text=Reading…')).toBeVisible();

    const msg = await page.evaluate(() => (window as any).__last_message);
    expect(msg).toEqual({ type: 'readRegister', name: 'CTRL' });

    // Simulate the extension host's reply. CTRL = 0b0101 -> ENABLE=1, MODE=2.
    await page.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'liveValues', values: { CTRL: 0x5 } } })
      );
    });

    await expect(page.locator('[data-testid="live-register-value"]')).toHaveText(
      'Live: 0x00000005'
    );
  });

  test('a liveValues reply decodes into per-field values in the fields table', async ({ page }) => {
    await page.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'liveValues', values: { CTRL: 0x5 } } })
      );
    });

    await expect(page.locator('[data-testid="live-register-value"]')).toBeVisible();

    // ENABLE (bit 0) decodes to 1, MODE (bits [3:1]) decodes to 2 (0b010) — the
    // fields table displays reset values as hex.
    await expect(page.locator('td[data-col-key="reset"] input').nth(0)).toHaveValue('0x1');
    await expect(page.locator('td[data-col-key="reset"] input').nth(1)).toHaveValue('0x2');
  });

  test('a liveValues error reply shows the error text, not a value', async ({ page }) => {
    const readButton = page.locator('button[aria-label="Read CTRL from hardware"]');
    await readButton.click();

    await page.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'liveValues', errors: { CTRL: 'Not connected' } },
        })
      );
    });

    await expect(page.locator('text=Not connected')).toBeVisible();
    await expect(page.locator('[data-testid="live-register-value"]')).not.toBeVisible();
  });

  test('a liveValues message never reaches the document (no update is sent)', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__last_message = null;
    });

    await page.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'liveValues', values: { CTRL: 0x5 } } })
      );
    });

    await expect(page.locator('[data-testid="live-register-value"]')).toBeVisible();

    // Confirm no outbound 'update' message was triggered by the incoming
    // liveValues message (it must never touch the revisioned sync protocol).
    await page.waitForTimeout(300);
    const lastMsg = await page.evaluate(() => (window as any).__last_message);
    expect(lastMsg).toBeNull();
  });
});
