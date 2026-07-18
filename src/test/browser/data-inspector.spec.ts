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

  test('aligns field overlays with their bit cells in a partial lane', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(harnessPath);
    await decode(page, "32'hDEADBEEF");
    await page.getByLabel('Lane width').selectOption('64');
    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByLabel('LSB').fill('28');

    const [segmentBox, msbBox, lsbBox] = await Promise.all([
      page.getByTitle('FIELD_1 [31:28]').boundingBox(),
      page.locator('.di-bits.is-field [data-bit="31"]').boundingBox(),
      page.locator('.di-bits.is-field [data-bit="28"]').boundingBox(),
    ]);
    expect(segmentBox).not.toBeNull();
    expect(msbBox).not.toBeNull();
    expect(lsbBox).not.toBeNull();
    expect(Math.abs(segmentBox!.x - msbBox!.x)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(segmentBox!.x + segmentBox!.width - (lsbBox!.x + lsbBox!.width))
    ).toBeLessThanOrEqual(1);
  });

  test('keeps bit zoom cells and field overlays on the same scroll track', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(harnessPath);
    await decode(page, "32'hDEADBEEF");
    await page.getByLabel('Lane width').selectOption('64');
    await page.getByLabel('Zoom').selectOption('bit');
    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByLabel('LSB').fill('28');

    const [segmentBox, msbBox, lsbBox] = await Promise.all([
      page.getByTitle('FIELD_1 [31:28]').boundingBox(),
      page.locator('.di-bits.is-bit [data-bit="31"]').boundingBox(),
      page.locator('.di-bits.is-bit [data-bit="28"]').boundingBox(),
    ]);
    expect(segmentBox).not.toBeNull();
    expect(msbBox).not.toBeNull();
    expect(lsbBox).not.toBeNull();
    expect(Math.abs(segmentBox!.x - msbBox!.x)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(segmentBox!.x + segmentBox!.width - (lsbBox!.x + lsbBox!.width))
    ).toBeLessThanOrEqual(1);
  });

  test('keeps a bounded live DOM for 4096 bits', async ({ page }) => {
    await page.goto(harnessPath);
    await decode(page, `${4096}'h${'A5'.repeat(512)}`);

    await expect(page.locator('.di-lanes')).toHaveAttribute('aria-rowcount', '128');
    expect(await page.locator('.di-lane').count()).toBeLessThanOrEqual(12);
  });

  test('keeps long register layout names inside the inspector', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(harnessPath);
    await decode(page, "32'hDEADBEEF");
    await page.getByRole('button', { name: 'Inspect' }).click();
    await page.getByRole('tab', { name: 'Capture' }).click();

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

    const [inspectorBox, selectBox] = await Promise.all([
      page.locator('.di-inspector').boundingBox(),
      layoutSelect.boundingBox(),
    ]);
    expect(inspectorBox).not.toBeNull();
    expect(selectBox).not.toBeNull();
    expect(selectBox!.x + selectBox!.width).toBeLessThanOrEqual(
      inspectorBox!.x + inspectorBox!.width - 11
    );
  });

  test('keeps sources, bits, and workflow tools inside the desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(harnessPath);
    await decode(page, "128'h00112233445566778899AABBCCDDEEFF");

    for (let index = 0; index < 4; index++) {
      await page.getByRole('button', { name: 'Add source' }).click();
    }
    await page.getByRole('tab', { name: 'Capture' }).click();
    await expect(page.getByRole('heading', { name: 'Capture' })).toBeVisible();
    await page.getByRole('tab', { name: 'Transform' }).click();
    await page.getByRole('button', { name: 'Byte swap' }).click();

    const layout = await page.evaluate(() => ({
      pageOverflow: document.documentElement.scrollHeight - window.innerHeight,
      sourceOverflow:
        document.querySelector<HTMLElement>('.di-source-rail')!.scrollHeight -
        document.querySelector<HTMLElement>('.di-source-rail')!.clientHeight,
      workspaceBottom: document.querySelector('.di-workspace')!.getBoundingClientRect().bottom,
    }));
    expect(layout.pageOverflow).toBeLessThanOrEqual(1);
    expect(layout.sourceOverflow).toBeGreaterThan(0);
    expect(layout.workspaceBottom).toBeLessThanOrEqual(884);
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
