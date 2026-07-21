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

// Regression coverage for the access-column-ux fix: short tokens in the
// closed dropdown control, an open listbox that stays inside the viewport
// and below the sticky header (not clipped/painted over), and a Monitors
// affordance that no longer breaks uniform row height for W1C fields.
test.describe('Fields table access column at narrow editor width (access-column-ux)', () => {
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
            access: read-write-self-clearing
            resetValue: 0
            description: Enables all channels simultaneously
          - name: IRQ_STATUS
            bits: "[1:1]"
            access: write-1-to-clear
            resetValue: 0
            description: Interrupt status, write 1 to clear
            monitorChangeOf: ENABLE_ALL
          - name: RESERVED_1
            bits: "[2:2]"
            access: read-only
            resetValue: 0
            description: Reserved bit
`;

  test.beforeEach(async ({ page }) => {
    const readyPromise = page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('VSCODE_MESSAGE:') && msg.text().includes('"ready"'),
      timeout: 10000,
    });

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

  test('closed access control shows the untruncated short token', async ({ page }) => {
    // ENABLE_ALL uses 'read-write-self-clearing' (24 chars, the longest enum
    // value) -- if the closed control were still showing the full enum name
    // instead of the RWSC token, this is where it would overflow/ellipsize.
    const select = page.locator('td[data-col-key="access"] select[data-edit-key="access"]').first();
    await expect(select).toHaveValue('read-write-self-clearing');
    await expect(select.locator('option:checked')).toHaveText('RWSC');
  });

  test('a single click activates a select on a non-selected row', async ({ page }) => {
    // Previously: double-click the cell to enter edit mode (pointer-events
    // gating), then a separate click to open the listbox -- 3 clicks total.
    // Opening a listbox is non-destructive/cancellable (Esc, outside-click),
    // unlike dropping a caret into text, so the dropdown variant now always
    // accepts pointer events and a single click opens it directly. Use
    // RESERVED_1 (third field, index 2) -- not the row selected by default
    // -- to make sure this holds for a row the user has not touched yet.
    const select = page.locator('td[data-col-key="access"] select[data-edit-key="access"]').nth(2);
    await select.click();
    await expect(select).toBeFocused();
  });

  test('supports keyboard selection without changing the message contract', async ({ page }) => {
    const select = page.locator('td[data-col-key="access"] select[data-edit-key="access"]').nth(2);
    await page.evaluate(() => {
      (window as any).__last_message = null;
      (window as any).__native_select_key_allowed = null;
      document.addEventListener(
        'keydown',
        (event) => {
          if (event.target instanceof HTMLSelectElement && event.key === 'ArrowDown') {
            (window as any).__native_select_key_allowed = !event.defaultPrevented;
          }
        },
        { once: true }
      );
    });
    await select.focus();
    await select.press('ArrowDown');
    expect(await page.evaluate(() => (window as any).__native_select_key_allowed)).toBe(true);
    await select.selectOption('write-only');
    await page.waitForFunction(() => (window as any).__last_message?.type === 'update');

    const message = await page.evaluate(() => (window as any).__last_message);
    expect(message.type).toBe('update');
    expect(message.text).toContain('access: write-only');
  });

  test('all body rows (including the W1C row) have equal height', async ({ page }) => {
    // The first field is selected by default (`vscode-row-selected`), which
    // intentionally renders taller (pre-existing selection styling,
    // unrelated to this fix). What this test guards is the W1C row no
    // longer growing taller than an ordinary row now that the Monitors
    // sub-row has been replaced by an inline icon button -- compare the
    // unselected rows (the W1C row and the plain row) against each other.
    const heights = await page
      .locator('[data-fields-table="true"] tbody tr[data-row-id]:not(.vscode-row-selected)')
      .evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height));

    expect(heights.length).toBe(2);
    const first = heights[0];
    for (const h of heights) {
      expect(Math.abs(h - first)).toBeLessThan(1);
    }
  });
});
