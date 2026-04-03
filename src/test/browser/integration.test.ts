/* eslint-disable */
import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('IPCraft Webview UI Integration', () => {
  const harnessPath = `file://${path.resolve(__dirname, 'index.html')}`;

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const html = await page.content();
      console.log(`Page HTML on failure (${testInfo.title}):`, html);
    }
  });

  test.beforeEach(async ({ page }) => {
    // Log console messages from the page
    page.on('console', (msg) => {
      if (msg.text().startsWith('VSCODE_MESSAGE:')) {
        console.log('Browser PostMessage:', msg.text().substring(15));
      } else {
        console.log('Browser Console:', msg.text());
      }
    });

    // Wait for ready message from the webview
    console.log('Waiting for READY message from webview...');
    const readyPromise = page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('VSCODE_MESSAGE:') && msg.text().includes('"ready"'),
      timeout: 10000,
    });

    await page.goto(harnessPath);

    // Wait for React to hydrate
    await page.waitForSelector('#root div');

    await readyPromise;
    console.log('READY message received, sending initial YAML');

    // Render initial data with retries until loading disappears
    await page.evaluate(() => {
      const yaml = `
addressBlocks:
  - name: REGS
    description: Test registers
    base_address: 0
    registers:
      - name: CTRL
        description: Control register
        address_offset: 0
        fields:
          - name: ENABLE
            bits: "[0:0]"
            reset_value: "0x0"
`;
      const send = () => {
        if ((window as any).__RENDER__) {
          (window as any).__RENDER__(yaml);
        } else {
          window.postMessage(
            {
              type: 'update',
              text: yaml,
            },
            '*'
          );
        }
      };

      const interval = setInterval(() => {
        if (document.body.innerText.includes('Loading memory map...')) {
          send();
        } else {
          clearInterval(interval);
        }
      }, 500);

      // First attempt
      send();

      // Safety timeout
      setTimeout(() => clearInterval(interval), 10000);
    });

    // Wait for main content
    await page.waitForSelector('#root main', { timeout: 15000 });
  });

  test('should render, edit and post message correctly', async ({ page }) => {
    // 1. Initial render check
    await expect(page.locator('section')).toContainText('REGS', { timeout: 15000 });

    const ctrlItem = page.locator('[role="treeitem"] >> text=CTRL').first();
    await expect(ctrlItem).toBeVisible();

    // 2. Click to open editor
    await ctrlItem.click();

    // Wait for details panel header
    const editorHeader = page.locator('h2:has-text("CTRL")');
    await expect(editorHeader).toBeVisible();

    // 3. Edit a field
    const bitsInput = page.locator('[data-edit-key="bits"]').first();
    await expect(bitsInput).toBeVisible();

    // Reset last message tracker
    await page.evaluate(() => {
      (window as any).__last_message = null;
    });

    // Action: Click, clear and type
    await bitsInput.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('[1:0]');
    await page.keyboard.press('Enter');

    // 4. Verification of outbound message
    await page.waitForFunction(
      () => {
        const msg = (window as any).__last_message;
        return msg && msg.type === 'update';
      },
      { timeout: 10000 }
    );

    const lastMsg = await page.evaluate(() => (window as any).__last_message);
    expect(lastMsg.type).toBe('update');
    expect(lastMsg.text).toContain("'[1:0]'");
  });
});

test.describe('IPCraft IP Core Webview Integration', () => {
  const harnessPath = `file://${path.resolve(__dirname, 'ipcore.html')}`;

  const sampleIpCoreYaml = `
apiVersion: '1.0'
vlnv:
  vendor: test.com
  library: smoke
  name: test_core
  version: 1.0.0
description: Smoke test IP core
bus_interfaces:
  - name: S_AXI
    type: AXI4L
    mode: slave
`;

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const html = await page.content();
      console.log(`IPCore page HTML on failure (${testInfo.title}):`, html.substring(0, 2000));
    }
  });

  test('should render IP Core navigation sidebar from injected YAML', async ({ page }) => {
    // Wait for ready message from the webview
    const readyPromise = page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('VSCODE_MESSAGE:') && msg.text().includes('"ready"'),
      timeout: 10000,
    });

    await page.goto(harnessPath);

    // Wait for the React app to mount
    await page.waitForSelector('#ipcore-root');

    await readyPromise;

    // Inject IP Core YAML via postMessage (same shape the extension host sends)
    await page.evaluate((yaml) => {
      window.postMessage({ type: 'update', text: yaml, fileName: 'test_core.ip.yml' }, '*');
    }, sampleIpCoreYaml);

    // The navigation sidebar should render known section labels
    await expect(page.locator('nav').getByText('Metadata')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('nav').getByText('Bus Interfaces')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('nav').getByText('Ports')).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to Metadata section and display VLNV fields', async ({ page }) => {
    const readyPromise = page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('VSCODE_MESSAGE:') && msg.text().includes('"ready"'),
      timeout: 10000,
    });

    await page.goto(harnessPath);
    await page.waitForSelector('#ipcore-root');
    await readyPromise;

    await page.evaluate((yaml) => {
      window.postMessage({ type: 'update', text: yaml, fileName: 'test_core.ip.yml' }, '*');
    }, sampleIpCoreYaml);

    // Click Metadata in sidebar
    await page.locator('nav').getByText('Metadata').click();

    // The editor panel should show the Metadata heading and VLNV row labels
    await expect(page.locator('h2', { hasText: 'Metadata' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Vendor')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Name')).toBeVisible({ timeout: 5000 });
  });
});
