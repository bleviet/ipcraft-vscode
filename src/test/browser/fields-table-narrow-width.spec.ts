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

  test('closed access control shows the untruncated short token (no ellipsis)', async ({
    page,
  }) => {
    // ENABLE_ALL uses 'read-write-self-clearing' (24 chars, the longest enum
    // value) -- if the closed control were still showing the full enum name
    // instead of the RWSC token, this is where it would overflow/ellipsize.
    const dropdown = page
      .locator('td[data-col-key="access"] vscode-dropdown[data-edit-key="access"]')
      .first();

    const { scrollWidth, clientWidth } = await dropdown.evaluate((el) => {
      const inner = (el.shadowRoot?.querySelector('.selected-value') as HTMLElement | null) ?? el;
      return { scrollWidth: inner.scrollWidth, clientWidth: inner.clientWidth };
    });

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('a single click on a non-selected row opens the access listbox (3-clicks-to-1 regression)', async ({
    page,
  }) => {
    // Previously: double-click the cell to enter edit mode (pointer-events
    // gating), then a separate click to open the listbox -- 3 clicks total.
    // Opening a listbox is non-destructive/cancellable (Esc, outside-click),
    // unlike dropping a caret into text, so the dropdown variant now always
    // accepts pointer events and a single click opens it directly. Use
    // RESERVED_1 (third field, index 2) -- not the row selected by default
    // -- to make sure this holds for a row the user has not touched yet.
    const dropdown = page
      .locator('td[data-col-key="access"] vscode-dropdown[data-edit-key="access"]')
      .nth(2);

    await expect(dropdown).toHaveAttribute('aria-expanded', 'false');

    await dropdown.click();

    await expect(dropdown).toHaveAttribute('aria-expanded', 'true');
  });

  test('opening the access dropdown yields a listbox fully inside the viewport and below the sticky header', async ({
    page,
  }) => {
    // ENABLE_ALL is the first (topmost) row, immediately under the sticky
    // header -- the case where an upward-opening popup used to be painted
    // over by the header.
    const accessCell = page.locator('td[data-col-key="access"]').first();
    await accessCell.dblclick();

    const dropdown = page
      .locator('td[data-col-key="access"] vscode-dropdown[data-edit-key="access"]')
      .first();
    await dropdown.click();
    // The toolkit reflects `open`/`aria-expanded` a tick after the click
    // handler runs; wait for it before reading the listbox's geometry, or
    // the rect below is read while it is still hidden (all zeros).
    await expect(dropdown).toHaveAttribute('aria-expanded', 'true');

    const listboxBox = await dropdown.evaluate((el) => {
      const listbox = el.shadowRoot?.querySelector('.listbox') as HTMLElement | null;
      if (!listbox) {
        return null;
      }
      const r = listbox.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
    });
    expect(listboxBox).not.toBeNull();

    const theadBottom = await page
      .locator('thead')
      .first()
      .evaluate((el) => el.getBoundingClientRect().bottom);
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    // 1px tolerance: the native toolkit listbox is anchored to the host's
    // left edge with no viewport-edge collision detection (the plan keeps
    // the native VSCodeDropdown rather than a custom-positioned popup), so
    // sub-pixel table-layout rounding can put its right edge a fraction of
    // a pixel past the viewport boundary. That is not visually perceptible;
    // this guards against a real (many-pixel) regression, not rounding.
    const EPS = 1;
    expect(listboxBox!.left).toBeGreaterThanOrEqual(-EPS);
    expect(listboxBox!.top).toBeGreaterThanOrEqual(-EPS);
    expect(listboxBox!.right).toBeLessThanOrEqual(viewport!.width + EPS);
    expect(listboxBox!.bottom).toBeLessThanOrEqual(viewport!.height + EPS);
    // Positioned below the control (position="below"), so it never sits
    // under the sticky header.
    expect(listboxBox!.top).toBeGreaterThanOrEqual(theadBottom - EPS);
  });

  test('the popup opens below even when the control sits in the lower half of the viewport', async ({
    page,
  }) => {
    // Regression: fast-foundation auto-positioning flips the listbox upward
    // whenever there is more room above the control than below it, and the
    // upward popup is then clipped by the table's overflow-auto scroll
    // container. `position="below"` alone does not prevent this -- the
    // element latches `forcedPosition` at connect time, before the React
    // wrapper assigns the property -- so CellInput forces it via a ref.
    // The other popup test above renders the row near the top of a tall
    // viewport, where auto-positioning coincidentally picks "below"; this
    // one recreates the flip geometry.
    const accessCell = page.locator('td[data-col-key="access"]').first();
    const dropdown = page
      .locator('td[data-col-key="access"] vscode-dropdown[data-edit-key="access"]')
      .first();

    // Shrink the viewport so only ~60px remain below the control, leaving
    // more room above it -- the exact geometry that used to flip the popup.
    const initialBox = await dropdown.boundingBox();
    expect(initialBox).not.toBeNull();
    await page.setViewportSize({
      width: 900,
      height: Math.ceil(initialBox!.y + initialBox!.height + 60),
    });

    const ctrl = await dropdown.boundingBox();
    const viewport = page.viewportSize();
    expect(ctrl).not.toBeNull();
    expect(viewport).not.toBeNull();
    // Precondition for the regression scenario: more space above the
    // control than below it, otherwise this test degenerates into the
    // near-the-top case already covered above.
    expect(ctrl!.y).toBeGreaterThan(viewport!.height - (ctrl!.y + ctrl!.height));

    await accessCell.dblclick();
    await dropdown.click();
    await expect(dropdown).toHaveAttribute('aria-expanded', 'true');

    const geom = await dropdown.evaluate((el) => {
      const listbox = el.shadowRoot?.querySelector('.listbox') as HTMLElement | null;
      if (!listbox) {
        return null;
      }
      const host = el.getBoundingClientRect();
      const r = listbox.getBoundingClientRect();
      return { listTop: r.top, listHeight: r.height, hostBottom: host.bottom };
    });
    expect(geom).not.toBeNull();

    const EPS = 1;
    // The forced position must hold: the listbox starts at or below the
    // control's bottom edge (an auto-flipped popup would start above the
    // control's top) and is actually rendered.
    expect(geom!.listTop).toBeGreaterThanOrEqual(geom!.hostBottom - EPS);
    expect(geom!.listHeight).toBeGreaterThan(0);
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
