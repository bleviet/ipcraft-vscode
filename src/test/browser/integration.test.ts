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
    page.on('console', (msg) => {
      if (msg.text().startsWith('VSCODE_MESSAGE:')) {
        console.log('Browser PostMessage:', msg.text().substring(15));
      } else {
        console.log('Browser Console:', msg.text());
      }
    });

    console.log('Waiting for READY message from webview...');
    const readyPromise = page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('VSCODE_MESSAGE:') && msg.text().includes('"ready"'),
      timeout: 10000,
    });

    await page.goto(harnessPath);

    await page.waitForSelector('#root div');

    await readyPromise;
    console.log('READY message received, sending initial YAML');

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

      send();

      setTimeout(() => clearInterval(interval), 10000);
    });

    await page.waitForSelector('#root main', { timeout: 15000 });
  });

  test('should render, edit and post message correctly', async ({ page }) => {
    await expect(page.locator('section')).toContainText('REGS', { timeout: 15000 });

    // Clicking a register opens the master-detail block editor: the header shows
    // the block name (REGS) and the detail pane shows the selected register's
    // inline field table (an embedded RegisterEditor).
    const ctrlItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await ctrlItem.click();

    await expect(page.locator('h2:has-text("REGS")')).toBeVisible();
    await expect(page.locator('td[data-col-key="name"] input').first()).toHaveValue('ENABLE');

    await page.evaluate(() => {
      (window as any).__last_message = null;
    });

    // Fields require a double-click to enter edit mode; that focuses the MSB
    // input. Widen ENABLE from [0:0] to [1:0] by setting MSB to 1.
    await page.locator('td[data-col-key="bits"]').first().dblclick();
    const msbInput = page.getByPlaceholder('MSB').first();
    await expect(msbInput).toBeVisible();
    await msbInput.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');

    await page.waitForFunction(
      () => {
        const msg = (window as any).__last_message;
        return msg && msg.type === 'update';
      },
      { timeout: 10000 }
    );

    const lastMsg = await page.evaluate(() => (window as any).__last_message);
    expect(lastMsg.type).toBe('update');
    expect(lastMsg.text).toContain('"[1:0]"');
  });

  test('should focus and select newly inserted register on insert below', async ({ page }) => {
    const ctrlItem = page.locator('[role="treeitem"]', { hasText: 'CTRL' }).first();
    await expect(ctrlItem).toBeVisible();

    await ctrlItem.click({ button: 'right' });

    const insertBelowHeading = page.locator('text=Insert Below');
    await expect(insertBelowHeading).toBeVisible();

    const registerButtons = page.locator('button:has-text("Register")');
    await registerButtons.nth(1).click();

    const newRegItem = page.locator('[role="treeitem"]', { hasText: 'reg1' }).first();
    await expect(newRegItem).toBeVisible();

    await expect(newRegItem).toHaveClass(/selected/);
    await expect(ctrlItem).not.toHaveClass(/selected/);
  });

  test('should render tree with root, block, and register nodes', async ({ page }) => {
    const rootItem = page.locator('[data-outline-id="root"]');
    await expect(rootItem).toBeVisible();
    await expect(rootItem).toContainText('Memory Map');

    const blockItem = page.locator('[data-outline-id="block-0"]');
    await expect(blockItem).toBeVisible();
    await expect(blockItem).toContainText('REGS');

    const regItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await expect(regItem).toBeVisible();
    await expect(regItem).toContainText('CTRL');
  });

  test('should show the block editor with the register fields when CTRL is clicked', async ({
    page,
  }) => {
    const ctrlItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await ctrlItem.click();

    // Master-detail block screen: block header + CTRL's inline field table.
    await expect(page.locator('h2:has-text("REGS")')).toBeVisible({ timeout: 5000 });
    await expect(ctrlItem).toHaveClass(/selected/);
    await expect(page.locator('td[data-col-key="name"] input').first()).toHaveValue('ENABLE', {
      timeout: 5000,
    });
    await expect(page.getByPlaceholder('MSB').first()).toBeVisible({ timeout: 5000 });
  });

  test('should update details panel when selecting different tree nodes', async ({ page }) => {
    const multiYaml = `
addressBlocks:
  - name: REGS
    base_address: 0
    registers:
      - name: CTRL
        description: Control register
        address_offset: 0
        fields:
          - name: ENABLE
            bits: "[0:0]"
            reset_value: "0x0"
      - name: STATUS
        description: Status register
        address_offset: 4
        fields:
          - name: READY
            bits: "[0:0]"
            reset_value: "0x0"
`;
    await page.evaluate((yaml) => {
      (window as any).__RENDER__(yaml);
    }, multiYaml);

    await page.waitForTimeout(500);

    // Both registers live under one block, so the header stays "REGS"; the detail
    // pane swaps to show the selected register's fields. CTRL has field ENABLE,
    // STATUS has field READY — assert the detail follows the outline selection.
    const fieldName = page.locator('td[data-col-key="name"] input').first();

    const ctrlItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await ctrlItem.click();
    await expect(fieldName).toHaveValue('ENABLE', { timeout: 5000 });

    const statusItem = page.locator('[data-outline-id="block-0-reg-1"]');
    await statusItem.click();
    await expect(fieldName).toHaveValue('READY', { timeout: 5000 });
  });

  test('should show block editor when address block tree node is clicked', async ({ page }) => {
    const blockItem = page.locator('[data-outline-id="block-0"]');
    await blockItem.click();

    await expect(page.locator('h2:has-text("REGS")')).toBeVisible({ timeout: 5000 });
  });

  test('should show memory map editor when root tree node is clicked', async ({ page }) => {
    const rootItem = page.locator('[data-outline-id="root"]');
    await rootItem.click();

    const blocksTable = page.locator('[data-blocks-table]');
    await expect(blocksTable).toBeVisible({ timeout: 5000 });
  });

  test('should navigate tree items with ArrowDown key', async ({ page }) => {
    const tree = page.locator('[role="tree"]');
    await tree.focus();

    const rootItem = page.locator('[data-outline-id="root"]');
    await rootItem.click();

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    const blockItem = page.locator('[data-outline-id="block-0"]');
    await expect(blockItem).toHaveClass(/selected/);

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    const regItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await expect(regItem).toHaveClass(/selected/);
  });

  test('should rename a register via double-click on tree item', async ({ page }) => {
    const ctrlItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await ctrlItem.dblclick();

    const editInput = page.locator('.outline-inline-edit');
    await expect(editInput).toBeVisible({ timeout: 3000 });

    await editInput.fill('MY_REG');
    await editInput.press('Enter');

    await page.waitForTimeout(500);

    const renamedItem = page.locator('[role="treeitem"]', { hasText: 'MY_REG' });
    await expect(renamedItem).toBeVisible({ timeout: 5000 });
  });

  test('should insert register above via context menu', async ({ page }) => {
    const ctrlItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await ctrlItem.click({ button: 'right' });

    const insertAboveHeading = page.locator('text=Insert Above');
    await expect(insertAboveHeading).toBeVisible();

    const registerButtons = page.locator('button:has-text("Register")');
    await registerButtons.first().click();

    const newRegItem = page.locator('[role="treeitem"]', { hasText: 'reg1' }).first();
    await expect(newRegItem).toBeVisible({ timeout: 5000 });
  });

  test('should delete a register via context menu', async ({ page }) => {
    const ctrlItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await expect(ctrlItem).toBeVisible();

    await ctrlItem.click({ button: 'right' });

    const deleteBtn = page.locator('button:has-text("Delete")');
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    await page.waitForTimeout(500);

    const ctrlAfter = page.locator('[data-outline-id="block-0-reg-0"]');
    await expect(ctrlAfter).not.toBeVisible({ timeout: 5000 });
  });

  test('should filter tree items using search input', async ({ page }) => {
    const multiYaml = `
addressBlocks:
  - name: REGS
    base_address: 0
    registers:
      - name: CTRL
        address_offset: 0
        fields:
          - name: ENABLE
            bits: "[0:0]"
      - name: STATUS
        address_offset: 4
        fields:
          - name: READY
            bits: "[0:0]"
`;
    await page.evaluate((yaml) => {
      (window as any).__RENDER__(yaml);
    }, multiYaml);
    await page.waitForTimeout(500);

    const filterInput = page.locator('.outline-filter-input');
    await filterInput.fill('STATUS');

    await page.waitForTimeout(300);

    const ctrlItem = page.locator('[role="treeitem"]', { hasText: 'CTRL' });
    await expect(ctrlItem).not.toBeVisible({ timeout: 3000 });

    const statusItem = page.locator('[role="treeitem"]', { hasText: 'STATUS' });
    await expect(statusItem).toBeVisible();
  });

  test('should expand and collapse tree nodes via chevron click', async ({ page }) => {
    const blockChevron = page
      .locator(
        '[data-outline-id="block-0"] .codicon-chevron-down, [data-outline-id="block-0"] .codicon-chevron-right'
      )
      .first();

    const regItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await expect(regItem).toBeVisible();

    await blockChevron.click();
    await page.waitForTimeout(300);

    await expect(regItem).not.toBeVisible({ timeout: 3000 });

    await blockChevron.click();
    await page.waitForTimeout(300);

    await expect(regItem).toBeVisible({ timeout: 3000 });
  });

  test('should edit field reset value and post message', async ({ page }) => {
    const ctrlItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await ctrlItem.click();

    await expect(page.locator('td[data-col-key="name"] input').first()).toHaveValue('ENABLE', {
      timeout: 5000,
    });

    await page.evaluate(() => {
      (window as any).__last_message = null;
    });

    // Double-click the Reset cell to enter edit mode, then set 0x1.
    await page.locator('td[data-col-key="reset"]').first().dblclick();
    const resetInput = page.locator('td[data-col-key="reset"] [data-edit-key="reset"]').first();
    await expect(resetInput).toBeVisible();
    await resetInput.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('0x1');
    await page.keyboard.press('Enter');

    await page.waitForFunction(
      () => {
        const msg = (window as any).__last_message;
        return msg && msg.type === 'update';
      },
      { timeout: 10000 }
    );

    const lastMsg = await page.evaluate(() => (window as any).__last_message);
    expect(lastMsg.type).toBe('update');
  });

  test('should collapse all and expand all via toggle button', async ({ page }) => {
    const regItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await expect(regItem).toBeVisible();

    const toggleBtn = page.locator('.outline-filter-button');
    await toggleBtn.click();
    await page.waitForTimeout(300);

    const blockItem = page.locator('[data-outline-id="block-0"]');
    await expect(blockItem).toBeVisible();

    const blockRegChildren = page.locator('[data-outline-id="block-0-reg-0"]');
    await expect(blockRegChildren).not.toBeVisible({ timeout: 3000 });

    await toggleBtn.click();
    await page.waitForTimeout(300);

    await expect(regItem).toBeVisible({ timeout: 3000 });
  });

  test('should not show a base address in outline footer', async ({ page }) => {
    const footer = page.locator('.outline-footer');
    await expect(footer).toBeVisible();
    await expect(footer).not.toContainText('Base:');
  });

  test('should show item count for the selected level in outline footer', async ({ page }) => {
    const footer = page.locator('.outline-footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText('1 Block');

    await page.locator('[data-outline-id="block-0"]').click();
    await expect(footer).toContainText('1 Register');

    await page.locator('[data-outline-id="block-0-reg-0"]').click();
    await expect(footer).toContainText('1 Field');
  });

  test('should keyboard insert register after selection with o key', async ({ page }) => {
    const tree = page.locator('[role="tree"]');
    await tree.focus();

    const ctrlItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await ctrlItem.click();

    await page.evaluate(() => {
      (window as any).__last_message = null;
    });

    await page.keyboard.press('o');

    await expect(page.locator('[role="treeitem"]', { hasText: 'reg1' })).toBeVisible({
      timeout: 5000,
    });

    await page.waitForFunction(
      () => {
        const msg = (window as any).__last_message;
        return msg && msg.type === 'update' && msg.text.includes('reg1');
      },
      { timeout: 10000 }
    );

    const lastMsg = await page.evaluate(() => (window as any).__last_message);
    expect(lastMsg.type).toBe('update');
    expect(lastMsg.text).toContain('reg1');
  });

  test('should keyboard insert register before selection with shift+o key', async ({ page }) => {
    const tree = page.locator('[role="tree"]');
    await tree.focus();

    const ctrlItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await ctrlItem.click();

    await page.keyboard.press('Shift+o');

    // reg1 is inserted at index 0; CTRL shifts to index 1
    await expect(page.locator('[role="treeitem"]', { hasText: 'reg1' })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('[role="treeitem"]', { hasText: 'CTRL' })).toBeVisible({
      timeout: 5000,
    });
  });

  test('should keyboard delete selected register with d key', async ({ page }) => {
    const tree = page.locator('[role="tree"]');
    await tree.focus();

    const ctrlItem = page.locator('[data-outline-id="block-0-reg-0"]');
    await ctrlItem.click();

    await page.evaluate(() => {
      (window as any).__last_message = null;
    });

    await page.keyboard.press('d');

    await expect(ctrlItem).not.toBeVisible({ timeout: 5000 });

    await page.waitForFunction(
      () => {
        const msg = (window as any).__last_message;
        return msg && msg.type === 'update';
      },
      { timeout: 10000 }
    );

    const lastMsg = await page.evaluate(() => (window as any).__last_message);
    expect(lastMsg.type).toBe('update');
    expect(lastMsg.text).not.toContain('name: CTRL');
  });

  test('should keyboard insert address block after selection with o key', async ({ page }) => {
    const rootItem = page.locator('[data-outline-id="root"]');
    await rootItem.click();

    const blocksTable = page.locator('[data-blocks-table]');
    await expect(blocksTable).toBeVisible({ timeout: 5000 });

    // Click the REGS block row to select it before pressing o
    await blocksTable.locator('tr[data-row-id]').first().click();
    await blocksTable.focus();

    await page.evaluate(() => {
      (window as any).__last_message = null;
    });

    await page.keyboard.press('o');

    await expect(page.locator('[role="treeitem"]', { hasText: 'block1' })).toBeVisible({
      timeout: 5000,
    });

    await page.waitForFunction(
      () => {
        const msg = (window as any).__last_message;
        return msg && msg.type === 'update' && msg.text.includes('block1');
      },
      { timeout: 10000 }
    );

    const lastMsg = await page.evaluate(() => (window as any).__last_message);
    expect(lastMsg.type).toBe('update');
    expect(lastMsg.text).toContain('block1');
  });

  test('should keyboard delete selected address block with d key', async ({ page }) => {
    const twoBlockYaml = `
addressBlocks:
  - name: REGS_A
    base_address: 0
    registers:
      - name: CTRL
        address_offset: 0
        fields:
          - name: ENABLE
            bits: "[0:0]"
  - name: REGS_B
    base_address: 256
    registers:
      - name: STATUS
        address_offset: 0
        fields:
          - name: READY
            bits: "[0:0]"
`;
    await page.evaluate((yaml) => {
      (window as any).__RENDER__(yaml);
    }, twoBlockYaml);

    await expect(page.locator('[role="treeitem"]', { hasText: 'REGS_A' })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('[role="treeitem"]', { hasText: 'REGS_B' })).toBeVisible({
      timeout: 5000,
    });

    const rootItem = page.locator('[data-outline-id="root"]');
    await rootItem.click();

    const blocksTable = page.locator('[data-blocks-table]');
    await expect(blocksTable).toBeVisible({ timeout: 5000 });

    // Select REGS_B (second row) and delete it
    await blocksTable.locator('tr[data-row-id]').nth(1).click();
    await blocksTable.focus();

    await page.evaluate(() => {
      (window as any).__last_message = null;
    });

    await page.keyboard.press('d');

    await expect(page.locator('[role="treeitem"]', { hasText: 'REGS_B' })).not.toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('[role="treeitem"]', { hasText: 'REGS_A' })).toBeVisible({
      timeout: 5000,
    });

    await page.waitForFunction(
      () => {
        const msg = (window as any).__last_message;
        return msg && msg.type === 'update';
      },
      { timeout: 10000 }
    );

    const lastMsg = await page.evaluate(() => (window as any).__last_message);
    expect(lastMsg.type).toBe('update');
    expect(lastMsg.text).not.toContain('REGS_B');
  });
});

test.describe('IPCraft IP Core Webview Integration', () => {
  const harnessPath = `file://${path.resolve(__dirname, 'ipcore.html')}`;

  const sampleIpCoreYaml = `
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

  const ipCoreWithParams = `
vlnv:
  vendor: acme.com
  library: ip
  name: param_core
  version: 2.0.0
description: Core with parameters
bus_interfaces:
  - name: S_AXI
    type: AXI4L
    mode: slave
parameters:
  - name: ADDR_WIDTH
    value: 32
    dataType: integer
  - name: DATA_WIDTH
    value: 16
    dataType: integer
`;

  const ipCoreMultiBus = `
vlnv:
  vendor: multi.com
  library: bus
  name: dual_bus_core
  version: 1.0.0
description: Core with two bus interfaces
bus_interfaces:
  - name: S_AXI
    type: AXI4L
    mode: slave
  - name: M_AXI
    type: AXI4L
    mode: master
`;

  const ipCoreNoBus = `
vlnv:
  vendor: simple.com
  library: basic
  name: no_bus_core
  version: 1.0.0
description: Core without bus interfaces
clocks:
  - name: clk
    direction: in
resets:
  - name: rst
    direction: in
    polarity: activeHigh
`;

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const html = await page.content();
      console.log(`IPCore page HTML on failure (${testInfo.title}):`, html.substring(0, 2000));
    }
  });

  async function setupIpCore(page: any, yaml: string, fileName: string = 'test_core.ip.yml') {
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

  test('should render canvas view from injected YAML', async ({ page }) => {
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

    await expect(page.getByText('test_core.ip.yml')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('span', { hasText: /test\.com.*smoke.*test_core/ })).toBeVisible({
      timeout: 5000,
    });
  });

  test('should display VLNV info in header from injected YAML', async ({ page }) => {
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

    await expect(page.getByRole('button', { name: 'Table view' })).not.toBeVisible({
      timeout: 5000,
    });

    await expect(page.locator('span', { hasText: /test\.com/ })).toBeVisible({ timeout: 10000 });
  });

  test('should open body inspector when canvas block body is clicked', async ({ page }) => {
    await setupIpCore(page, sampleIpCoreYaml);

    const bodyRect = page.locator('.ip-block-body');
    await expect(bodyRect).toBeVisible({ timeout: 5000 });
    await bodyRect.click();

    const inspector = page.locator('.canvas-inspector');
    await expect(inspector).toBeVisible({ timeout: 5000 });

    await expect(inspector).toContainText('VLNV');
    await expect(inspector).toContainText('Vendor');
    await expect(inspector).toContainText('Library');
  });

  test('should edit VLNV vendor field in body inspector', async ({ page }) => {
    await setupIpCore(page, sampleIpCoreYaml);

    const bodyRect = page.locator('.ip-block-body');
    await bodyRect.click();

    const inspector = page.locator('.canvas-inspector');
    await expect(inspector).toBeVisible({ timeout: 5000 });

    await page.evaluate(() => {
      (window as any).__last_message = null;
    });

    const vendorField = inspector.locator('input').first();
    await vendorField.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('new-vendor.com');
    await page.keyboard.press('Enter');

    await page.waitForFunction(
      () => {
        const msg = (window as any).__last_message;
        return msg && msg.type === 'update';
      },
      { timeout: 10000 }
    );

    const lastMsg = await page.evaluate(() => (window as any).__last_message);
    expect(lastMsg.type).toBe('update');
    expect(lastMsg.text).toContain('new-vendor.com');
  });

  test('should render bus interface on canvas', async ({ page }) => {
    await setupIpCore(page, sampleIpCoreYaml);

    const canvas = page.locator('.ip-canvas-svg');
    await expect(canvas).toBeVisible({ timeout: 5000 });

    const busBundle = page.locator('[data-port-id^="bus:"]');
    await expect(busBundle.first()).toBeVisible({ timeout: 5000 });
  });

  test('should render parameters on canvas from injected YAML', async ({ page }) => {
    await setupIpCore(page, ipCoreWithParams);

    const canvas = page.locator('.ip-canvas-svg');
    await expect(canvas).toBeVisible({ timeout: 5000 });

    const paramText = page.locator('.ip-block-param-name');
    await expect(paramText.first()).toBeVisible({ timeout: 5000 });

    const canvasSvg = page.locator('.ip-canvas-svg');
    await expect(canvasSvg).toContainText('ADDR_WIDTH');
    await expect(canvasSvg).toContainText('DATA_WIDTH');
  });

  test('should display file name in header', async ({ page }) => {
    await setupIpCore(page, sampleIpCoreYaml, 'my_custom_core.ip.yml');

    const header = page.locator('h1');
    await expect(header).toContainText('my_custom_core.ip.yml', { timeout: 5000 });
  });

  test('should render multiple bus interfaces simultaneously', async ({ page }) => {
    await setupIpCore(page, ipCoreMultiBus);

    const busBundles = page.locator('[data-port-id^="bus:"]');
    await expect(busBundles.first()).toBeVisible({ timeout: 5000 });

    const count = await busBundles.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('should handle YAML with no bus interfaces gracefully', async ({ page }) => {
    await setupIpCore(page, ipCoreNoBus);

    const canvas = page.locator('.ip-canvas-svg');
    await expect(canvas).toBeVisible({ timeout: 5000 });

    const header = page.locator('h1');
    await expect(header).toContainText('test_core.ip.yml', { timeout: 5000 });

    const busBundles = page.locator('[data-port-id^="bus:"]');
    const count = await busBundles.count();
    expect(count).toBe(0);
  });

  test('should show empty state when no IP core is loaded', async ({ page }) => {
    const readyPromise = page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('VSCODE_MESSAGE:') && msg.text().includes('"ready"'),
      timeout: 10000,
    });

    await page.goto(harnessPath);
    await page.waitForSelector('#ipcore-root');
    await readyPromise;

    await expect(page.getByText('No IP core loaded')).toBeVisible({ timeout: 10000 });
  });

  test('should undo and redo vendor edits via toolbar buttons', async ({ page }) => {
    await setupIpCore(page, sampleIpCoreYaml);

    const bodyRect = page.locator('.ip-block-body');
    await bodyRect.click();

    const inspector = page.locator('.canvas-inspector');
    await expect(inspector).toBeVisible({ timeout: 5000 });

    const vendorField = inspector.locator('input').first();
    await vendorField.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('edited-vendor.com');
    await page.keyboard.press('Enter');

    // Wait for postMessage with the edited vendor value
    await page.waitForFunction(
      () => {
        const msg = (window as any).__last_message;
        return msg && msg.type === 'update' && msg.text.includes('edited-vendor.com');
      },
      { timeout: 10000 }
    );

    // Undo: vendor reverts to test.com
    await page.evaluate(() => {
      (window as any).__last_message = null;
    });
    const undoBtn = page.locator('button[aria-label="Undo"]');
    await expect(undoBtn).not.toBeDisabled({ timeout: 3000 });
    await undoBtn.click();

    await page.waitForFunction(
      () => {
        const msg = (window as any).__last_message;
        return msg && msg.type === 'update' && msg.text.includes('test.com');
      },
      { timeout: 10000 }
    );

    const afterUndo = await page.evaluate(() => (window as any).__last_message);
    expect(afterUndo.text).toContain('test.com');
    expect(afterUndo.text).not.toContain('edited-vendor.com');

    // Redo: vendor goes back to edited-vendor.com
    await page.evaluate(() => {
      (window as any).__last_message = null;
    });
    const redoBtn = page.locator('button[aria-label="Redo"]');
    await expect(redoBtn).not.toBeDisabled({ timeout: 3000 });
    await redoBtn.click();

    await page.waitForFunction(
      () => {
        const msg = (window as any).__last_message;
        return msg && msg.type === 'update' && msg.text.includes('edited-vendor.com');
      },
      { timeout: 10000 }
    );

    const afterRedo = await page.evaluate(() => (window as any).__last_message);
    expect(afterRedo.text).toContain('edited-vendor.com');
  });
});
