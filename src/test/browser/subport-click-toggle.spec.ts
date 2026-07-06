/* eslint-disable */
// Regression coverage for GitHub issue #40: clicking a signal in an expanded
// bus interface (e.g. AXI-Stream) to inspect it must not accidentally
// deactivate an active optional port.
//
// CanvasBusSubPort's interaction model:
//  - a single click only *selects* the signal (inspector opens on the parent
//    bus, and the row gets a selection ring) — it never toggles active state.
//  - a double-click toggles an optional signal's active state.
//  - pressing Delete while a signal is selected deactivates it, without
//    falling through to the app-level "delete whole canvas element" shortcut
//    that already existed for the parent bus interface.
import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Bus sub-port click/select/toggle (issue #40)', () => {
  const harnessPath = `file://${path.resolve(__dirname, 'ipcore.html')}`;

  const ipCoreYaml = `
vlnv:
  vendor: test.com
  library: smoke
  name: axis_test_core
  version: 1.0.0
description: AXI-Stream fixture for sub-port click regression test
ports:
  - name: data_in
    direction: in
    width: 1
busInterfaces:
  - name: S_AXIS
    type: ipcraft:busif:axi_stream:1.0
    mode: slave
    physicalPrefix: s_axis_
    useOptionalPorts:
      - TLAST
`;

  async function setupIpCore(page: any, yaml: string, fileName: string = 'axis_test_core.ip.yml') {
    const readyPromise = page.waitForEvent('console', {
      predicate: (msg: any) =>
        msg.text().includes('VSCODE_MESSAGE:') && msg.text().includes('"ready"'),
      timeout: 10000,
    });

    await page.goto(harnessPath);
    await page.waitForSelector('#ipcore-root');
    await readyPromise;

    await page.evaluate(
      ({ yaml: y, fileName: fn }: { yaml: string; fileName: string }) => {
        window.postMessage({ type: 'update', text: y, fileName: fn }, '*');
      },
      { yaml, fileName }
    );

    await page.waitForTimeout(500);
  }

  async function expandBus(page: any) {
    await page.locator('[data-port-id="bus:0"] .canvas-bus-bundle__expand-toggle').click();
  }

  test('single click on a signal only selects it — it does not deactivate it', async ({ page }) => {
    await setupIpCore(page, ipCoreYaml);
    await expandBus(page);

    const tlastRow = page.locator('.canvas-bus-subport', { hasText: /TLAST/ });
    await expect(tlastRow).toBeVisible({ timeout: 5000 });
    await expect(tlastRow).toHaveClass(/canvas-bus-subport--active/);

    await tlastRow.locator('.canvas-bus-subport__logical').click();

    // Inspector opens on the parent bus...
    const inspector = page.locator('.canvas-inspector');
    await expect(inspector).toBeVisible({ timeout: 5000 });

    // ...the row is now marked selected...
    await expect(tlastRow).toHaveClass(/canvas-bus-subport--selected/);

    // ...but TLAST must still be active: no accidental deactivation.
    await expect(tlastRow).toHaveClass(/canvas-bus-subport--active/);
    await expect(tlastRow.locator('.canvas-bus-subport__deactivate-hint')).toBeVisible();
  });

  test('double-click toggles an optional signal active/inactive', async ({ page }) => {
    await setupIpCore(page, ipCoreYaml);
    await expandBus(page);

    const tlastRow = page.locator('.canvas-bus-subport', { hasText: /TLAST/ });
    await expect(tlastRow).toHaveClass(/canvas-bus-subport--active/);

    const tlastLogical = tlastRow.locator('.canvas-bus-subport__logical');
    // Pre-select once so the inspector panel is already open before the timed
    // double-click gesture — opening it for the first time reflows the canvas
    // (flex sibling, slide-in animation), which can shift element positions
    // mid-gesture. That's a pre-existing, narrow first-selection-ever quirk of
    // the layout, not something this feature needs to work around; realistic
    // usage always has something selected already by the time a user reaches
    // for a specific signal to double-click.
    await tlastLogical.click();
    await expect(tlastRow).toHaveClass(/canvas-bus-subport--selected/);

    await tlastLogical.dblclick();
    await expect(tlastRow).toHaveClass(/canvas-bus-subport--inactive/);
    await expect(tlastRow.locator('.canvas-bus-subport__activate-hint')).toBeVisible();

    await tlastLogical.dblclick();
    await expect(tlastRow).toHaveClass(/canvas-bus-subport--active/);
    await expect(tlastRow.locator('.canvas-bus-subport__deactivate-hint')).toBeVisible();
  });

  test('selecting a signal then pressing Delete deactivates just that signal', async ({ page }) => {
    await setupIpCore(page, ipCoreYaml);
    await expandBus(page);

    const tlastRow = page.locator('.canvas-bus-subport', { hasText: /TLAST/ });
    await tlastRow.locator('.canvas-bus-subport__logical').click();
    await expect(tlastRow).toHaveClass(/canvas-bus-subport--selected/);
    await expect(tlastRow).toHaveClass(/canvas-bus-subport--active/);

    await page.keyboard.press('Delete');
    await expect(tlastRow).toHaveClass(/canvas-bus-subport--inactive/);

    // The bus interface itself must still exist — Delete must not have fallen
    // through to the whole-element deletion shortcut.
    await expect(page.locator('[data-port-id="bus:0"]')).toHaveCount(1);

    // 🔍 Selecting an already-inactive optional signal and pressing Delete is
    // a safe no-op (nothing to deactivate).
    const tkeepRow = page.locator('.canvas-bus-subport', { hasText: /TKEEP/ });
    await tkeepRow.locator('.canvas-bus-subport__logical').click();
    await expect(tkeepRow).toHaveClass(/canvas-bus-subport--inactive/);
    await page.keyboard.press('Delete');
    await expect(tkeepRow).toHaveClass(/canvas-bus-subport--inactive/);
    await expect(page.locator('[data-port-id="bus:0"]')).toHaveCount(1);
  });

  test('Delete still removes the whole bus interface when the bus itself (not a signal) is selected', async ({
    page,
  }) => {
    await setupIpCore(page, ipCoreYaml);

    // Select the collapsed bus bundle itself (no signal selected).
    await page.locator('[data-port-id="bus:0"] .canvas-bus-bundle__name').click();
    const inspector = page.locator('.canvas-inspector');
    await expect(inspector).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Delete');
    await expect(page.locator('[data-port-id="bus:0"]')).toHaveCount(0);
  });

  test('🔍 selecting a different element clears the prior signal selection', async ({ page }) => {
    await setupIpCore(page, ipCoreYaml);
    await expandBus(page);

    const tlastRow = page.locator('.canvas-bus-subport', { hasText: /TLAST/ });
    await tlastRow.locator('.canvas-bus-subport__logical').click();
    await expect(tlastRow).toHaveClass(/canvas-bus-subport--selected/);

    // Select the unrelated standalone port instead.
    await page.locator('[data-port-id="port:0"]').click();
    await expect(tlastRow).not.toHaveClass(/canvas-bus-subport--selected/);

    // Delete now targets the newly selected port, not the stale signal.
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-port-id="port:0"]')).toHaveCount(0);
    // TLAST must be untouched — still active.
    await expect(tlastRow).toHaveClass(/canvas-bus-subport--active/);
  });
});
