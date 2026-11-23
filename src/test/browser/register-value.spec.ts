/* eslint-disable */
// Regression coverage: setting a register's value in the Memory Map viewer must
// not silently discard the change. A register value has no storage of its own —
// it lives in the bit fields — so a register without fields now writes its own
// `resetValue`, and a value whose set bits no field covers is rejected with a
// message instead of being partially written.
//
// Needs the real webview (postMessage round-trip + YAML write-back), so this
// runs in a browser against a stand-in for the extension host.
import { test, expect, type Page } from '@playwright/test';
import path from 'path';

const harnessPath = `file://${path.resolve(__dirname, 'index.html')}`;

const yaml = `addressBlocks:
  - name: GLOBAL_REGS
    baseAddress: 0
    registers:
      - name: FULLY_COVERED
        addressOffset: 0
        size: 32
        fields:
          - name: ALL
            bits: "[31:0]"
            access: read-write
            resetValue: 0
      - name: PARTIALLY_COVERED
        addressOffset: 4
        size: 32
        fields:
          - name: LOW
            bits: "[3:0]"
            access: read-write
            resetValue: 0
      - name: NO_FIELDS
        addressOffset: 8
        size: 32
`;

/** Stand-in for the extension host: serialized document, version stamping, stale-base rejection. */
async function installFakeHost(page: Page, initial: string) {
  await page.evaluate((text) => {
    const host = { text, version: 1, log: [] as string[] };
    (window as any).__HOST__ = host;
    window.addEventListener('vscode-post-message', (ev: any) => {
      const msg = ev.detail;
      if (msg?.type !== 'update') return;
      host.log.push(`edit#${msg.editId}`);
      if (msg.baseDocVersion !== undefined && msg.baseDocVersion !== host.version) {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'update', text: host.text, docVersion: host.version, forceResync: true },
          })
        );
        return;
      }
      if (host.text === msg.text) return;
      host.text = msg.text;
      host.version += 1;
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'update',
            text: host.text,
            docVersion: host.version,
            sourceEditId: msg.editId,
          },
        })
      );
    });
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'update', text, docVersion: 1 } })
    );
  }, initial);
}

async function setRegisterValue(page: Page, hex: string) {
  const input = page.getByLabel('Register value (hex)');
  await input.click();
  await input.fill(hex);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  return input;
}

const docText = (page: Page) => page.evaluate(() => (window as any).__HOST__.text as string);

test.beforeEach(async ({ page }) => {
  const readyPromise = page.waitForEvent('console', {
    predicate: (msg) => msg.text().includes('VSCODE_MESSAGE:') && msg.text().includes('"ready"'),
    timeout: 15000,
  });
  await page.goto(harnessPath);
  await page.waitForSelector('#root div');
  await readyPromise;
  await installFakeHost(page, yaml);
  await page.waitForSelector('#root main', { timeout: 15000 });
});

test('a register whose fields cover every bit stores the value in its fields', async ({ page }) => {
  await page.locator('[data-outline-id="block-0-reg-0"]').click();
  const input = await setRegisterValue(page, '0000A5A5');

  expect(await docText(page)).toContain('resetValue: 42405');
  await expect(input).toHaveValue('0000A5A5');
});

test('a register without bit fields stores the value in its own resetValue', async ({ page }) => {
  await page.locator('[data-outline-id="block-0-reg-2"]').click();
  const input = await setRegisterValue(page, '0000A5A5');

  const text = await docText(page);
  expect(text).toMatch(/name: NO_FIELDS[\s\S]*resetValue: 42405/);
  await expect(input).toHaveValue('0000A5A5');
  await expect(page.locator('.vscode-error')).toHaveCount(0);
});

test('a fieldless register keeps its value after navigating away and back', async ({ page }) => {
  await page.locator('[data-outline-id="block-0-reg-2"]').click();
  await setRegisterValue(page, '0000A5A5');

  await page.locator('[data-outline-id="block-0-reg-0"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-outline-id="block-0-reg-2"]').click();
  await expect(page.getByLabel('Register value (hex)')).toHaveValue('0000A5A5');
});

test('bits no field covers are reported instead of partially written', async ({ page }) => {
  await page.locator('[data-outline-id="block-0-reg-1"]').click();
  const before = await docText(page);
  await setRegisterValue(page, '0000A5A5');

  await expect(page.locator('.vscode-error')).toContainText('not covered by a bit field');
  await expect(page.locator('.vscode-error')).toContainText('31:4');
  expect(await docText(page)).toBe(before);
});

test('a value that fits the covered bits still commits', async ({ page }) => {
  await page.locator('[data-outline-id="block-0-reg-1"]').click();
  await setRegisterValue(page, '00000005');

  expect(await docText(page)).toMatch(/name: LOW[\s\S]*resetValue: 5/);
  await expect(page.locator('.vscode-error')).toHaveCount(0);
});

test('a fieldless register stores its value from the block master-detail view', async ({
  page,
}) => {
  // The embedded RegisterEditor emits ['resetValue']; BlockEditor must prefix it
  // with ['registers', <idx>] or the write lands on the block instead.
  await page.locator('[data-outline-id="block-0"]').click();
  await page.waitForTimeout(300);
  await page.getByText('NO_FIELDS', { exact: true }).first().click();
  await page.waitForTimeout(300);

  await setRegisterValue(page, '0000A5A5');

  expect(await docText(page)).toMatch(/name: NO_FIELDS[\s\S]*resetValue: 42405/);
  await expect(page.locator('.vscode-error')).toHaveCount(0);
});
