import { test, expect } from '@playwright/test';
import path from 'path';

const harnessPath = `file://${path.resolve(__dirname, 'data-inspector.html')}`;

async function decode(page: import('@playwright/test').Page, literal: string) {
  await page.getByLabel('Literal').fill(literal);
  await page.getByRole('button', { name: 'Decode' }).click();
  await expect(page.getByRole('heading', { name: 'Bits' })).toBeVisible();
}

async function openFields(page: import('@playwright/test').Page) {
  if ((page.viewportSize()?.width ?? 1280) <= 1100) {
    await page.getByRole('button', { name: 'Inspect' }).click();
  }
  await page.getByRole('tab', { name: /Fields/ }).click();
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
    await expect(
      page.getByRole('region', { name: 'Bits' }).locator('.sr-only[aria-live="polite"]')
    ).toContainText('Lane 2');
  });

  test('deletes fields with the keyboard or by dragging outside the panel', async ({ page }) => {
    await page.goto(harnessPath);
    await decode(page, "8'hA5");
    await openFields(page);
    await page.getByRole('button', { name: 'Add field' }).click();

    const firstField = page.getByRole('row', { name: /FIELD_1/ });
    await firstField.focus();
    await page.keyboard.press('Delete');
    await expect(firstField).toHaveCount(0);

    await page.getByRole('button', { name: 'Add field' }).click();
    const secondField = page.getByRole('row', { name: /FIELD_2/ });
    const rowBounds = await secondField.boundingBox();
    const panelBounds = await page.locator('.di-fields').boundingBox();
    expect(rowBounds).not.toBeNull();
    expect(panelBounds).not.toBeNull();
    await page.mouse.move(
      rowBounds!.x + rowBounds!.width / 2,
      rowBounds!.y + rowBounds!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(panelBounds!.x - 24, panelBounds!.y + 40, { steps: 12 });
    await page.mouse.up();

    await expect(secondField).toHaveCount(0);
  });

  test('jumps to and highlights an exact bit index with range feedback', async ({ page }) => {
    await page.goto(harnessPath);
    await decode(page, "128'h00112233445566778899AABBCCDDEEFF");

    await page.getByLabel('Jump to bit').fill('6');
    await page.getByRole('button', { name: 'Jump' }).click();
    await expect(page.locator('.di-lane.is-target')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-bit="6"]')).toHaveClass(/is-target/);
    await expect(page.locator('#go-to-bit-status')).toHaveText('Bit 6 · lane [31:0]');

    await page.getByLabel('Jump to bit').fill('128');
    await page.getByRole('button', { name: 'Jump' }).click();
    await expect(page.locator('#go-to-bit-status')).toHaveText('Enter a bit from 0 to 127');
    await expect(page.locator('.di-lane.is-target')).toHaveCount(0);
  });

  test('emphasizes one bits without crossing out inactive or masked zero bits', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(harnessPath);
    await decode(page, "16'h099A");
    await page.getByRole('button', { name: 'bit', exact: true }).click();

    const one = page.locator('[data-bit="11"]');
    const zero = page.locator('[data-bit="14"]');
    await expect(one).toHaveClass(/is-one/);
    await expect(one).toHaveCSS('font-weight', '700');
    await expect(one).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(zero).toHaveClass(/is-zero/);
    await zero.evaluate((element) => element.classList.add('is-masked'));
    await expect(zero).toHaveCSS('text-decoration-line', 'none');
  });

  test('marks transform-inserted high bits beside projected source fields', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(harnessPath);
    await page.evaluate(() => {
      (
        window as unknown as { renderRecipe: (value: unknown, version?: number) => void }
      ).renderRecipe({
        version: 1,
        name: 'shifted-value',
        description: '',
        sources: [{ id: 'input', name: 'INPUT', width: 32 }],
        fields: [],
        overlayGroups: [{ id: 'default', name: 'Default' }],
        steps: [{ id: 'shifted', type: 'shiftRight', inputId: 'input', amount: 1 }],
        view: {
          laneWidth: 32,
          zoom: 'bit',
          selectedGroupId: 'default',
        },
      });
    });
    await decode(page, "32'h12345678");
    await page.locator('.react-flow__node[data-id="shifted"]').click();

    const inserted = page.getByTitle('Transform-inserted 0 [31:31]').last();
    await expect(inserted).toBeVisible();
    await expect(inserted).toHaveText('+0');
    const [insertedBox, bitBox] = await Promise.all([
      inserted.boundingBox(),
      page.locator('[data-bit="31"]').boundingBox(),
    ]);
    expect(insertedBox).not.toBeNull();
    expect(bitBox).not.toBeNull();
    expect(Math.abs(insertedBox!.x - bitBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(insertedBox!.width - bitBox!.width)).toBeLessThanOrEqual(1);
  });

  test('aligns field overlays with their bit cells in a partial lane', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(harnessPath);
    await decode(page, "32'hDEADBEEF");
    await page.getByRole('button', { name: '64', exact: true }).click();
    await openFields(page);
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
    await page.getByRole('button', { name: '64', exact: true }).click();
    await page.getByRole('button', { name: 'bit', exact: true }).click();
    await openFields(page);
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

  test('expands a 16-bit lane so an eight-bit field matches eight cells', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 });
    await page.goto(harnessPath);
    await decode(page, "32'h00000000");
    await page.getByRole('button', { name: '16', exact: true }).click();
    await page.getByRole('button', { name: 'bit', exact: true }).click();
    await openFields(page);
    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByLabel('MSB').fill('7');
    await page.getByLabel('LSB').fill('0');

    const [segmentBox, msbBox, lsbBox] = await Promise.all([
      page.getByTitle('FIELD_1 [7:0]').boundingBox(),
      page.locator('.di-bits.is-bit [data-bit="7"]').boundingBox(),
      page.locator('.di-bits.is-bit [data-bit="0"]').boundingBox(),
    ]);
    expect(segmentBox).not.toBeNull();
    expect(msbBox).not.toBeNull();
    expect(lsbBox).not.toBeNull();
    expect(Math.abs(segmentBox!.x - msbBox!.x)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(segmentBox!.x + segmentBox!.width - (lsbBox!.x + lsbBox!.width))
    ).toBeLessThanOrEqual(1);
    expect(segmentBox!.width / msbBox!.width).toBeCloseTo(8, 1);
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
    await openFields(page);
    await page.getByText('Import register layout').click();

    const layoutSelect = page.getByLabel('Register');
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

  test('keeps wide field values in their columns and displays known ranges as hex', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 840, height: 1000 });
    await page.goto(harnessPath);
    await decode(page, "32'h12345678");
    await openFields(page);
    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByLabel('LSB').fill('2');

    const row = page.getByRole('row', { name: /FIELD_1/ });
    const cells = row.locator('span');
    await expect(cells.nth(2)).toHaveText('000100100011010001010110011110');
    await expect(cells.nth(2)).toHaveCSS('overflow', 'hidden');
    await expect(cells.nth(3)).toHaveText('0x048D159E');
    expect(
      await row.evaluate((element) => element.scrollWidth - element.clientWidth)
    ).toBeLessThanOrEqual(1);
  });

  test('keeps sources, bits, and workflow tools inside the desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(harnessPath);
    await decode(page, "128'h00112233445566778899AABBCCDDEEFF");

    for (let index = 0; index < 4; index++) {
      await page.getByRole('button', { name: 'Add source' }).click();
      await expect(page.locator('.di-flow-source')).toHaveCount(index + 2);
    }
    await page.getByRole('button', { name: 'Add Byte swap draft' }).click();

    const layout = await page.evaluate(() => ({
      pageOverflow: document.documentElement.scrollHeight - window.innerHeight,
      libraryOverflow:
        document.querySelector<HTMLElement>('.di-library')!.scrollHeight -
        document.querySelector<HTMLElement>('.di-library')!.clientHeight,
      workspaceBottom: document.querySelector('.di-workbench')!.getBoundingClientRect().bottom,
    }));
    expect(layout.pageOverflow).toBeLessThanOrEqual(1);
    expect(layout.libraryOverflow).toBeLessThanOrEqual(1);
    expect(layout.workspaceBottom).toBeLessThanOrEqual(884);
  });

  test('retains visible boundaries and selection patterns in forced colors', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto(harnessPath);
    await decode(page, "32'hDEADBEEF");
    await openFields(page);
    await page.getByRole('button', { name: 'Add field' }).click();

    const segment = page.locator('.di-field-segment').first();
    await expect(segment).toBeVisible();
    await expect(segment).toHaveCSS('outline-style', 'dashed');
  });
});
