import { test, expect } from '@playwright/test';
import path from 'path';
import { builtinBusLibrary } from '../helpers/busLibrary';

test.describe('canonical bus contract library', () => {
  const harnessPath = `file://${path.resolve(__dirname, 'ipcore.html')}`;
  const busLibrary = builtinBusLibrary();

  const ipCoreYaml = `
vlnv:
  vendor: test.com
  library: smoke
  name: canonical_contracts
  version: 1.0.0
clocks:
  - name: clk
resets:
  - name: rst_n
busInterfaces:
  - name: S_AVALON
    type: xilinx.com:interface:avalon:1.0
    mode: slave
    physicalPrefix: avs_
    associatedClock: clk
    associatedReset: rst_n
  - name: M_AXIS
    type: AXIS
    mode: master
    physicalPrefix: m_axis_
    associatedClock: clk
    associatedReset: rst_n
`;

  test.beforeEach(async ({ page }) => {
    const readyPromise = page.waitForEvent('console', {
      predicate: (message) =>
        message.text().includes('VSCODE_MESSAGE:') && message.text().includes('"ready"'),
      timeout: 10000,
    });
    await page.goto(harnessPath);
    await page.waitForSelector('#ipcore-root');
    await readyPromise;
    await page.evaluate(
      ({ text, library }) => {
        window.postMessage(
          {
            type: 'update',
            text,
            fileName: 'canonical_contracts.ip.yml',
            imports: { busLibrary: library },
          },
          '*'
        );
      },
      { text: ipCoreYaml, library: busLibrary }
    );
    await page.waitForTimeout(500);
  });

  test('renders the canonical Avalon-MM port set and roles', async ({ page }) => {
    const bundle = page.locator('[data-port-id="bus:0"]');
    await bundle.locator('.canvas-bus-bundle__expand-toggle').click();

    const names = await page.locator('.canvas-bus-subport__logical').allTextContents();
    expect(names).toEqual([
      'address[31:0]',
      'read',
      'write',
      'byteenable[3:0]',
      'byteenable_n[3:0]',
      'debugaccess',
      'lock',
      'writedata[31:0]',
      'readdata[31:0]',
      'readdatavalid',
      'readdatavalid_n',
      'writeresponsevalid',
      'waitrequest',
      'waitrequest_n',
      'response[1:0]',
      'burstcount[7:0]',
      'beginbursttransfer',
      'read_n',
      'write_n',
    ]);
    expect(names).not.toContain('clk');
    expect(names).not.toContain('reset');
    expect(names).not.toContain('chipselect');
  });

  test('keeps bundle and subport inspector selection behavior', async ({ page }) => {
    const bundle = page.locator('[data-port-id="bus:0"]');
    await bundle.locator('.canvas-bus-bundle__name').click();
    await expect(page.locator('.canvas-inspector .ci-header__name')).toHaveText('S_AVALON');

    await bundle.locator('.canvas-bus-bundle__expand-toggle').click();
    const subport = page.locator('.canvas-bus-subport', { hasText: /byteenable_n/ });
    await subport.locator('.canvas-bus-subport__logical').click();
    await expect(subport).toHaveClass(/canvas-bus-subport--selected/);
    await expect(page.locator('.canvas-inspector .ci-header__name')).toHaveText('S_AVALON');
  });
});
