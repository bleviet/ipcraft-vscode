import { test, expect } from '@playwright/test';
import path from 'path';

const harnessPath = `file://${path.resolve(__dirname, 'data-inspector.html')}`;

async function decode(page: import('@playwright/test').Page, literal: string) {
  await page.getByLabel('Literal').fill(literal);
  await page.getByRole('button', { name: 'Decode' }).click();
  await expect(page.getByRole('heading', { name: 'Bits' })).toBeVisible();
}

test.describe('Data Inspector responsive and accessible workspace', () => {
  for (const width of [640, 900, 1440]) {
    test(`keeps bits visible without page-level horizontal scrolling at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(harnessPath);
      await decode(page, "128'h00112233445566778899AABBCCDDEEFF");

      await expect(page.locator('.di-lanes')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await expect(page.getByText('Session only · samples are never saved')).toBeVisible();
    });
  }

  test('uses one roving lane tab stop and announces keyboard lane navigation', async ({ page }) => {
    await page.goto(harnessPath);
    await decode(page, "128'h00112233445566778899AABBCCDDEEFF");
    const lanes = page.locator('.di-lane');

    await expect(lanes.first()).toHaveAttribute('tabindex', '0');
    await expect(lanes.nth(1)).toHaveAttribute('tabindex', '-1');
    await lanes.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(lanes.nth(1)).toBeFocused();
    await expect(page.locator('[aria-live="polite"]')).toContainText('Lane 2');
  });

  test('keeps a bounded live DOM for 4096 bits', async ({ page }) => {
    await page.goto(harnessPath);
    await decode(page, `${4096}'h${'A5'.repeat(512)}`);

    await expect(page.locator('.di-lanes')).toHaveAttribute('aria-rowcount', '128');
    expect(await page.locator('.di-lane').count()).toBeLessThanOrEqual(12);
  });

  test('keeps long register layout names inside the source rail', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(harnessPath);
    await decode(page, "32'hDEADBEEF");

    const layoutSelect = page.getByLabel('Import register layout');
    await layoutSelect.evaluate((select: HTMLSelectElement) => {
      select.add(
        new Option(
          'regmap_conformance.mm.yml · CSR/CHANNEL_CONFIGURATION_REGISTER',
          'long-layout',
          true,
          true
        )
      );
    });

    const [railBox, selectBox] = await Promise.all([
      page.locator('.di-source-rail').boundingBox(),
      layoutSelect.boundingBox(),
    ]);
    expect(railBox).not.toBeNull();
    expect(selectBox).not.toBeNull();
    expect(selectBox!.x + selectBox!.width).toBeLessThanOrEqual(railBox!.x + railBox!.width - 11);
  });

  test('retains visible boundaries and selection patterns in forced colors', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto(harnessPath);
    await decode(page, "32'hDEADBEEF");
    await page.getByRole('button', { name: 'Add field' }).click();

    const segment = page.locator('.di-field-segment').first();
    await expect(segment).toBeVisible();
    await expect(segment).toHaveCSS('outline-style', 'dashed');
  });
});
