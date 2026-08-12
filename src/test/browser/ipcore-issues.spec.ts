import { test, expect } from '@playwright/test';
import path from 'path';
import { builtinBusLibrary } from '../helpers/busLibrary';

test.describe('IP core Issues workflow', () => {
  const harnessPath = `file://${path.resolve(__dirname, 'ipcore.html')}`;
  const invalidYaml = `
vlnv:
  vendor: test.com
  library: smoke
  name: invalid_axis
  version: 1.0.0
busInterfaces:
  - name: M_AXIS
    type: ipcraft:busif:axi_stream:1.0
    mode: master
    physicalPrefix: m_axis_
    useOptionalPorts: [TKEEP]
    portWidthOverrides:
      TDATA: 32
      TKEEP: 5
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
            fileName: 'invalid_axis.ip.yml',
            imports: { busLibrary: library },
          },
          '*'
        );
      },
      { text: invalidYaml, library: builtinBusLibrary() }
    );
    await expect(page.getByRole('button', { name: /\d+ errors, \d+ warnings/ })).toBeVisible();
  });

  test('marks the bundle and subport, focuses the issue, and surfaces blocked generation', async ({
    page,
  }) => {
    const issueCount = page.getByRole('button', { name: /\d+ errors, \d+ warnings/ });
    await expect(issueCount).toHaveAccessibleName('2 errors, 0 warnings');
    await issueCount.click();

    const issuesPanel = page.getByRole('complementary', { name: 'Issues' });
    await expect(issuesPanel).toBeVisible();
    await expect(page.getByText('Protocol', { exact: true })).toBeVisible();
    const issueRow = issuesPanel.getByRole('button', {
      name: /TKEEP must match its derived contract width/,
    });
    await expect(issueRow).toBeVisible();

    const bundle = page.locator('[data-port-id="bus:0"]');
    await expect(bundle.locator('.ip-canvas-annotation-dot--error')).toBeVisible();
    const subport = page.locator('.canvas-bus-subport', { hasText: /TKEEP/ });
    await expect(subport.locator('.ip-canvas-annotation-dot--error')).toBeVisible();

    await issueRow.click();
    await expect(bundle).toHaveClass(/selected/);
    await expect(page.locator('#bus-0-width-TKEEP')).toBeFocused();

    await page
      .getByRole('button', {
        name: 'Scaffold Project (RTL + EDA packaging + Testbench)',
      })
      .click();
    await page.evaluate(() => {
      window.postMessage(
        {
          type: 'generateResult',
          success: false,
          issues: [
            {
              code: 'BUS_DERIVED_WIDTH_OVERRIDE',
              severity: 'error',
              source: 'protocol',
              path: ['busInterfaces', 0, 'portWidthOverrides', 'TKEEP'],
              interfaceName: 'M_AXIS',
              message: 'TKEEP must match its derived contract width.',
            },
          ],
        },
        '*'
      );
    });
    const blockedPanel = page.getByRole('complementary', { name: 'Issues' });
    await expect(blockedPanel).toBeVisible();
    await expect(
      blockedPanel.getByRole('button', { name: /TKEEP must match its derived contract width/ })
    ).toBeVisible();
  });

  test('keeps preview save enabled while surfacing an unresolved bus warning', async ({ page }) => {
    const unresolvedYaml = `
vlnv:
  vendor: test.com
  library: smoke
  name: imported_stream
  version: 1.0.0
busInterfaces:
  - name: stream
    type: acme.com:bus:future_stream:1.0
    mode: source
    physicalPrefix: stream_
`;
    await page.evaluate(
      ({ text, library }) => {
        window.postMessage(
          {
            type: 'update',
            text,
            fileName: 'future_stream_hw.tcl',
            isPreview: true,
            imports: { busLibrary: library },
          },
          '*'
        );
      },
      { text: unresolvedYaml, library: builtinBusLibrary() }
    );

    await expect(page.getByRole('button', { name: '0 errors, 1 warning' })).toBeVisible();
    const save = page.getByRole('button', { name: 'Save as .ip.yml' });
    await expect(save).toBeEnabled();
    await expect(save).toHaveAttribute('title', /Save with unresolved bus warnings/);
    await save.click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as typeof window & { __last_message?: unknown }).__last_message)
      )
      .toMatchObject({ type: 'saveAsIpYml' });
  });
});
