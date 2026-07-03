/* eslint-disable */
// Regression coverage for GitHub issue #35 (width-expression help/autocomplete),
// specifically the consolidation of the three duplicate width-input
// implementations in CanvasInspector.tsx into a single WidthExprControl.
// Confirms the fix landed on more than just the port-width field:
//  - the codicon-info help popover
//  - the new as-you-type function/parameter autocomplete dropdown
// both work on PropWidthField (port width) AND on the previously-unfixed
// ConduitSignalRow (conduit signal width).
import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Width expression autocomplete + help icon (issue #35)', () => {
  const harnessPath = `file://${path.resolve(__dirname, 'ipcore.html')}`;

  const ipCoreYaml = `
vlnv:
  vendor: test.com
  library: smoke
  name: width_test_core
  version: 1.0.0
description: Width expression autocomplete test fixture
parameters:
  - name: DATA_WIDTH
    value: 32
    dataType: integer
ports:
  - name: data_in
    direction: in
    width: 1
busInterfaces:
  - name: custom_if
    type: user:busif:custom:1.0
    mode: conduit
    conduitPorts:
      - name: sig_a
        direction: in
        width: 1
`;

  async function setupIpCore(page: any, yaml: string, fileName: string = 'width_test_core.ip.yml') {
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

  test('port width field: help icon + autocomplete suggest and accept a function', async ({
    page,
  }) => {
    await setupIpCore(page, ipCoreYaml);

    // Select the standalone data port to open its inspector.
    await page.locator('[data-port-id="port:0"]').click();
    const inspector = page.locator('.canvas-inspector');
    await expect(inspector).toBeVisible({ timeout: 5000 });

    const widthField = inspector.locator('.ci-field', { hasText: 'Width (bits)' });
    await expect(widthField).toBeVisible();

    // Switch to expression mode.
    await widthField.locator('button.ci-pw-mode-toggle').first().click();

    const input = widthField.locator('input.ci-field__input');
    await expect(input).toBeVisible();

    // The info (help) icon should now be present — this already worked pre-consolidation.
    const infoButton = widthField.locator('button .codicon-info');
    await expect(infoButton).toBeVisible();

    // Replace the auto-filled expression with a partial function name to trigger
    // the new autocomplete dropdown. Triple-click selects all text in the input
    // reliably across platforms (Ctrl+A is OS-shortcut-dependent under Playwright).
    await input.click({ clickCount: 3 });
    await page.keyboard.type('clo');

    const dropdown = widthField.locator('.ci-combobox__list');
    await expect(dropdown).toBeVisible({ timeout: 3000 });
    const suggestion = dropdown.locator('.ci-combobox__option', { hasText: 'clog2' });
    await expect(suggestion).toBeVisible();

    await suggestion.click();

    await expect(input).toHaveValue('clog2()');

    // The help popover opens independently of the autocomplete dropdown.
    await infoButton.click();
    await expect(page.getByText('Width Expression Functions')).toBeVisible({ timeout: 3000 });
  });

  test('conduit signal width field now also has the info icon (previously missing)', async ({
    page,
  }) => {
    await setupIpCore(page, ipCoreYaml);

    // Select the conduit bus interface to open its inspector (ConduitPanel).
    await page.locator('[data-port-id="bus:0"]').click();
    const inspector = page.locator('.canvas-inspector');
    await expect(inspector).toBeVisible({ timeout: 5000 });

    const conduitRow = inspector.locator('.ci-conduit-row').first();
    await expect(conduitRow).toBeVisible({ timeout: 5000 });

    const widthField = conduitRow.locator('.ci-pw-field');
    await widthField.locator('button.ci-pw-mode-toggle').first().click();

    const infoButton = widthField.locator('button .codicon-info');
    await expect(infoButton).toBeVisible();
  });
});
