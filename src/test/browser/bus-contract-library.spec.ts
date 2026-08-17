import { test, expect } from '@playwright/test';
import path from 'path';
import * as yaml from 'js-yaml';
import { builtinBusLibrary } from '../helpers/busLibrary';

interface HarnessMessage {
  type: string;
  text: string;
}

function requireHarnessUpdateMessage(value: unknown): HarnessMessage {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('type' in value) ||
    value.type !== 'update' ||
    !('text' in value) ||
    typeof value.text !== 'string'
  ) {
    throw new Error('Expected byteenable activation to emit a well-formed YAML update');
  }
  return { type: value.type, text: value.text };
}

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

  test('renders one canonical Avalon-MM port per configurable polarity role', async ({ page }) => {
    const bundle = page.locator('[data-port-id="bus:0"]');
    await bundle.locator('.canvas-bus-bundle__expand-toggle').click();

    const names = await page.locator('.canvas-bus-subport__logical').allTextContents();
    expect(names).toEqual([
      'address[31:0]',
      'read',
      'write',
      'byteenable[3:0]',
      'debugaccess',
      'lock',
      'writedata[31:0]',
      'readdata[31:0]',
      'readdatavalid',
      'writeresponsevalid',
      'waitrequest',
      'response[1:0]',
      'burstcount[7:0]',
      'beginbursttransfer',
    ]);
    const configurableRows = [
      /^read$/,
      /^write$/,
      /^byteenable\[3:0\]$/,
      /^readdatavalid$/,
      /^waitrequest$/,
    ];
    for (const logicalName of configurableRows) {
      const row = page.locator('.canvas-bus-subport', {
        has: page.locator('.canvas-bus-subport__logical', { hasText: logicalName }),
      });
      await expect(row).toHaveCount(1);
      await expect(row.locator('.canvas-bus-subport__polarity-badge')).toHaveText('H');
    }
    expect(names).not.toContain('clk');
    expect(names).not.toContain('reset');
    expect(names).not.toContain('chipselect');
  });

  test('keeps bundle and subport inspector selection behavior', async ({ page }) => {
    const bundle = page.locator('[data-port-id="bus:0"]');
    await bundle.locator('.canvas-bus-bundle__name').click();
    await expect(page.locator('.canvas-inspector .ci-header__name')).toHaveText('S_AVALON');

    await bundle.locator('.canvas-bus-bundle__expand-toggle').click();
    const subport = page.locator('.canvas-bus-subport', {
      has: page.locator('.canvas-bus-subport__logical', { hasText: /^byteenable\[3:0\]$/ }),
    });
    const logicalName = subport.locator('.canvas-bus-subport__logical');
    await logicalName.click();
    await expect(subport).toHaveClass(/canvas-bus-subport--selected/);
    await expect(subport).toHaveClass(/canvas-bus-subport--inactive/);
    await expect(page.locator('.canvas-inspector .ci-header__name')).toHaveText('S_AVALON');

    await page.evaluate(() => {
      Reflect.set(window, '__last_message', null);
      Reflect.set(window, '__activation_update_count', 0);
      window.addEventListener('vscode-post-message', (event: Event) => {
        if (!(event instanceof CustomEvent)) {
          return;
        }
        const detail: unknown = event.detail;
        if (
          typeof detail === 'object' &&
          detail !== null &&
          'type' in detail &&
          detail.type === 'update'
        ) {
          const currentCount: unknown = Reflect.get(window, '__activation_update_count');
          Reflect.set(
            window,
            '__activation_update_count',
            (typeof currentCount === 'number' ? currentCount : 0) + 1
          );
        }
      });
    });
    await logicalName.dblclick();
    await page.waitForFunction(() => {
      const updateCount: unknown = Reflect.get(window, '__activation_update_count');
      return typeof updateCount === 'number' && updateCount > 0;
    });
    await expect(subport).toHaveClass(/canvas-bus-subport--active/);

    const lastMessage = requireHarnessUpdateMessage(
      await page.evaluate(() => {
        const message: unknown = Reflect.get(window, '__last_message');
        return message;
      })
    );
    const emitted = yaml.load(lastMessage.text) as {
      busInterfaces: Array<Record<string, unknown> & { useOptionalPorts?: string[] }>;
    };
    expect(emitted.busInterfaces[0].useOptionalPorts).toContain('byteenable');
    expect(emitted.busInterfaces[0].useOptionalPorts).not.toContain('byteenable_n');
    expect(emitted.busInterfaces[1]).toEqual({
      name: 'M_AXIS',
      type: 'AXIS',
      mode: 'master',
      physicalPrefix: 'm_axis_',
      associatedClock: 'clk',
      associatedReset: 'rst_n',
    });
  });
});
