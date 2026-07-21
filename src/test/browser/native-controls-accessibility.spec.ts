import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import path from 'path';

const memoryMapHarness = `file://${path.resolve(__dirname, 'index.html')}`;
const ipCoreHarness = `file://${path.resolve(__dirname, 'ipcore.html')}`;

const memoryMapYaml = `
addressBlocks:
  - name: CTRL
    baseAddress: 0
    registers:
      - name: STATUS
        addressOffset: 0
        size: 32
        fields:
          - name: READY
            bits: "[0:0]"
            access: read-only
            resetValue: 0
            description: Ready status
`;

const ipCoreYaml = `
vlnv:
  vendor: test.com
  library: smoke
  name: accessible_controls
  version: 1.0.0
description: Native control accessibility fixture
`;

async function waitForReady(page: Page, root: string): Promise<void> {
  const ready = page.waitForEvent('console', {
    predicate: (message) =>
      message.text().includes('VSCODE_MESSAGE:') && message.text().includes('"ready"'),
    timeout: 10000,
  });
  await page.goto(root);
  await ready;
}

test.describe('native webview controls', () => {
  const themes = [
    { name: 'dark', className: 'vscode-dark', background: '#1e1e1e', foreground: '#cccccc' },
    { name: 'light', className: 'vscode-light', background: '#ffffff', foreground: '#3b3b3b' },
    {
      name: 'high-contrast',
      className: 'vscode-high-contrast',
      background: '#000000',
      foreground: '#ffffff',
    },
    {
      name: 'high-contrast-light',
      className: 'vscode-high-contrast-light',
      background: '#ffffff',
      foreground: '#000000',
    },
  ] as const;

  test('memory map table controls support focus, keyboard selection, and axe checks', async ({
    page,
  }) => {
    await waitForReady(page, memoryMapHarness);
    await page.evaluate((yaml) => {
      (window as Window & { __RENDER__?: (text: string) => void }).__RENDER__?.(yaml);
    }, memoryMapYaml);

    await page.locator('[data-outline-id="block-0-reg-0"]').click();
    const select = page.getByRole('combobox', { name: 'access' });
    await expect(select).toBeVisible();
    await select.focus();
    await expect(select).toBeFocused();
    await select.press('ArrowDown');

    const results = await new AxeBuilder({ page })
      .include('[data-fields-table="true"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(results.violations.filter((violation) => violation.impact === 'serious')).toEqual([]);
    expect(results.violations.filter((violation) => violation.impact === 'critical')).toEqual([]);
  });

  test('IP Core inspector controls have associated labels and no serious axe violations', async ({
    page,
  }) => {
    await waitForReady(page, ipCoreHarness);
    await page.evaluate((yaml) => {
      window.postMessage(
        { type: 'update', text: yaml, fileName: 'accessible_controls.ip.yml' },
        '*'
      );
    }, ipCoreYaml);

    await page.locator('.ip-block-body').click();
    const inspector = page.locator('.canvas-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByLabel('Vendor')).toHaveValue('test.com');

    const results = await new AxeBuilder({ page })
      .include('.canvas-inspector')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(
      results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical'
      )
    ).toEqual([]);
  });

  for (const theme of themes) {
    test(`keeps controls visible and focused in ${theme.name}`, async ({ page }, testInfo) => {
      await waitForReady(page, memoryMapHarness);
      await page.evaluate(
        ({ yaml, className, background, foreground }) => {
          document.body.className = className;
          document.documentElement.style.setProperty('--vscode-editor-background', background);
          document.documentElement.style.setProperty('--vscode-editor-foreground', foreground);
          document.documentElement.style.setProperty('--vscode-input-background', background);
          document.documentElement.style.setProperty('--vscode-input-foreground', foreground);
          document.documentElement.style.setProperty('--vscode-dropdown-background', background);
          document.documentElement.style.setProperty('--vscode-dropdown-foreground', foreground);
          document.documentElement.style.setProperty('--vscode-dropdown-border', foreground);
          document.documentElement.style.setProperty('--vscode-focusBorder', '#007acc');
          (window as Window & { __RENDER__?: (text: string) => void }).__RENDER__?.(yaml);
        },
        { yaml: memoryMapYaml, ...theme }
      );

      await page.locator('[data-outline-id="block-0-reg-0"]').click();
      const select = page.getByRole('combobox', { name: 'access' });
      await select.focus();
      await expect(select).toBeVisible();
      await expect(select).toBeFocused();
      await expect(select).toHaveCSS('outline-style', 'solid');
      await page.screenshot({ path: testInfo.outputPath(`native-controls-${theme.name}.png`) });
    });
  }
});
