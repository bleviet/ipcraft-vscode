/* eslint-disable */
// Verifies that clicking a bus interface or reset name inside the Bus Interface
// Matrix overview (opened via the canvas "Ports" header) selects that element the
// same way clicking a parameter name in the Generics overview does: the matrix
// panel is replaced by that single element's own inspector panel, and the
// corresponding stub on the canvas gets the selection highlight.
import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Bus Interface Matrix row selection', () => {
  const harnessPath = `file://${path.resolve(__dirname, 'ipcore.html')}`;

  const ipCoreYaml = `
vlnv:
  vendor: test.com
  library: smoke
  name: matrix_test_core
  version: 1.0.0
clocks:
  - name: clk_sys
resets:
  - name: rst_n
    polarity: activeLow
  - name: restart
    polarity: activeHigh
interrupts:
  - name: event_high
    sensitivity: LEVEL_HIGH
  - name: event_low
    sensitivity: LEVEL_LOW
  - name: event_rise
    sensitivity: EDGE_RISING
  - name: event_fall
    sensitivity: EDGE_FALLING
busInterfaces:
  - name: S_AXI
    type: ipcraft:busif:axi4_lite:1.0
    mode: slave
    physicalPrefix: s_axi_
    associatedClock: clk_sys
    associatedReset: rst_n
`;

  async function setupIpCore(
    page: any,
    yaml: string,
    fileName: string = 'matrix_test_core.ip.yml'
  ) {
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

  test('clicking a bus interface name in the matrix selects it on the canvas and opens its panel', async ({
    page,
  }) => {
    await setupIpCore(page, ipCoreYaml);

    await page.locator('.ip-block-ports-row-bg').click();
    const inspector = page.locator('.canvas-inspector');
    await expect(inspector).toBeVisible({ timeout: 5000 });
    await expect(inspector.locator('.ci-busmatrix-row__name', { hasText: 'S_AXI' })).toBeVisible();

    await inspector.locator('.ci-busmatrix-row__name', { hasText: 'S_AXI' }).click();

    // The matrix table is gone, replaced by the single bus interface's own panel.
    await expect(inspector.locator('.ci-busmatrix-row')).toHaveCount(0);
    await expect(inspector.locator('.ci-header__name')).toHaveText('S_AXI');
    await expect(inspector.locator('.ci-badge')).toHaveText('Bus Interface');

    // The bus bundle on the canvas is now highlighted as selected.
    await expect(page.locator('[data-port-id="bus:0"]')).toHaveClass(/canvas-bus-bundle--selected/);
  });

  test('clicking a reset name in the matrix selects it on the canvas and opens its panel', async ({
    page,
  }) => {
    await setupIpCore(page, ipCoreYaml);

    await page.locator('.ip-block-ports-row-bg').click();
    const inspector = page.locator('.canvas-inspector');
    await expect(inspector).toBeVisible({ timeout: 5000 });
    await expect(inspector.locator('.ci-busmatrix-row__name', { hasText: 'rst_n' })).toBeVisible();

    await inspector.locator('.ci-busmatrix-row__name', { hasText: 'rst_n' }).click();

    await expect(inspector.locator('.ci-busmatrix-row')).toHaveCount(0);
    await expect(inspector.locator('.ci-header__name')).toHaveText('rst_n');
    // The Reset panel's badge confirms we drilled into the single-element view.
    await expect(inspector.locator('.ci-badge')).toHaveText('Reset');

    await expect(page.locator('[data-port-id="reset:0"]')).toHaveClass(/canvas-port--selected/);
  });

  test('shows reset polarity on the canvas independently of the port name', async ({ page }) => {
    await setupIpCore(page, ipCoreYaml);

    const activeLow = page.locator('[data-port-id="reset:0"]');
    const activeHigh = page.locator('[data-port-id="reset:1"]');

    await expect(activeLow).toHaveAttribute('aria-label', 'rst_n: active-low reset');
    await expect(activeLow.locator('.canvas-port__polarity-badge')).toHaveText('L');
    await expect(activeLow.locator('.canvas-port__inversion-bubble')).toBeVisible();

    await expect(activeHigh).toHaveAttribute('aria-label', 'restart: active-high reset');
    await expect(activeHigh.locator('.canvas-port__polarity-badge')).toHaveText('H');
    await expect(activeHigh.locator('.canvas-port__inversion-bubble')).toHaveCount(0);
  });

  test('shows all interrupt sensitivity symbols independently of port names', async ({ page }) => {
    await setupIpCore(page, ipCoreYaml);

    const expected = [
      ['event_high', 'LEVEL_HIGH', 'level-high'],
      ['event_low', 'LEVEL_LOW', 'level-low'],
      ['event_rise', 'EDGE_RISING', 'rising-edge'],
      ['event_fall', 'EDGE_FALLING', 'falling-edge'],
    ] as const;

    for (const [index, [name, sensitivity, label]] of expected.entries()) {
      const port = page.locator(`[data-port-id="interrupt:${index}"]`);
      await expect(port).toHaveAttribute('data-interrupt-sensitivity', sensitivity);
      await expect(port).toHaveAttribute('aria-label', `${name}: ${label} interrupt`);

      const glyph = port.locator('.canvas-port__interrupt-sensitivity-glyph > svg');
      await expect(glyph).toHaveCount(1);
      await expect
        .poll(() => glyph.evaluate((element) => (element as SVGGraphicsElement).getBBox().width))
        .toBeGreaterThan(0);
    }
  });
});
