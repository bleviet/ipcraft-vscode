/* eslint-disable */
// `$version` references in the Memory Map editor: typing a token in a field's reset cell, the
// resolved-value hint, the scheme diagnostics, and `$version` on a fieldless register via the
// value bar.
//
// Needs the real webview (postMessage round-trip + YAML write-back + the versionContext
// notification), so this runs in a browser against a stand-in for the extension host.
import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import jsyaml from 'js-yaml';

const harnessPath = `file://${path.resolve(__dirname, 'index.html')}`;

const yaml = `addressBlocks:
  - name: GLOBAL_REGS
    baseAddress: 0
    registers:
      - name: VERSION
        addressOffset: 0
        size: 32
        fields:
          - name: MAJOR
            bits: "[23:16]"
            access: read-only
            resetValue: 0
      - name: NO_FIELDS
        addressOffset: 4
        size: 32
`;

const tokenYaml = `addressBlocks:
  - name: GLOBAL_REGS
    baseAddress: 0
    registers:
      - name: VERSION
        addressOffset: 0
        size: 32
        fields:
          - name: MAJOR
            bits: "[23:16]"
            access: read-only
            resetValue: $version.major
`;

// A register that got `resetValue: $version` while it had no fields.
const fieldlessRefYaml = `addressBlocks:
  - name: GLOBAL_REGS
    baseAddress: 0
    registers:
      - name: VERSION
        addressOffset: 0
        size: 32
        resetValue: $version
`;

// The same register after fields were added around the reference (hand-edited, or from an
// earlier release): the reference is invalid next to bit fields.
const fieldsWithRefYaml = `addressBlocks:
  - name: GLOBAL_REGS
    baseAddress: 0
    registers:
      - name: VERSION
        addressOffset: 0
        size: 32
        resetValue: $version
        fields:
          - name: LOW
            bits: "[7:0]"
            access: read-write
            resetValue: 0
`;

const registerOf = (text: string) =>
  (jsyaml.load(text) as any).addressBlocks[0].registers[0] as Record<string, any>;

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

async function postVersionContext(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'versionContext',
          context: {
            status: 'resolved',
            versionScheme: 'major.minor.patch',
            version: '1.4.2',
            ipCorePath: 'ip/core.ip.yml',
          },
        },
      })
    );
  });
}

async function open(page: Page, text: string) {
  const readyPromise = page.waitForEvent('console', {
    predicate: (msg) => msg.text().includes('VSCODE_MESSAGE:') && msg.text().includes('"ready"'),
    timeout: 15000,
  });
  await page.goto(harnessPath);
  await page.waitForSelector('#root div');
  await readyPromise;
  await installFakeHost(page, text);
  await page.waitForSelector('#root main', { timeout: 15000 });
}

const docText = (page: Page) => page.evaluate(() => (window as any).__HOST__.text as string);
const updateCount = (page: Page) =>
  page.evaluate(() => (window as any).__HOST__.log.length as number);

async function typeInResetCell(page: Page, text: string) {
  await page.locator('td[data-col-key="reset"]').first().dblclick();
  const input = page.locator('input[data-edit-key="reset"]').first();
  await input.fill(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}

test('a $version reference typed in a field reset cell is written, resolved and shown in the value bar', async ({
  page,
}) => {
  await open(page, yaml);
  await postVersionContext(page);
  await page.locator('[data-outline-id="block-0-reg-0"]').click();

  await typeInResetCell(page, '$version.major');

  expect(await docText(page)).toMatch(/resetValue: ["']?\$version\.major["']?/);
  await expect(page.getByTestId('version-ref-hint')).toHaveText('= 0x01');
  await expect(page.locator('input[data-edit-key="reset"]').first()).toHaveValue('$version.major');
  // MAJOR is bits [23:16]: the packed bits show the resolved major version.
  await expect(page.getByLabel('Register value (hex)')).toHaveValue('00010000');
  await expect(page.locator('.vscode-error')).toHaveCount(0);
});

test('a reference the scheme does not have shows the scheme diagnostic', async ({ page }) => {
  await open(page, yaml);
  await postVersionContext(page);
  await page.locator('[data-outline-id="block-0-reg-0"]').click();

  await typeInResetCell(page, '$version.feature');

  await expect(page.getByTestId('version-issues')).toContainText(
    '$version.feature is not available in version scheme major.minor.patch'
  );
});

test('an unknown reference is rejected without writing the document', async ({ page }) => {
  await open(page, yaml);
  await postVersionContext(page);
  await page.locator('[data-outline-id="block-0-reg-0"]').click();
  const before = await docText(page);

  await typeInResetCell(page, '$version.foo');

  await expect(page.locator('.vscode-error').first()).toContainText(
    'Use $version, $version.major, $version.minor, $version.patch, $version.crc8 or $version.crc16'
  );
  expect(await docText(page)).toBe(before);
});

test('unparseable reset text reports Invalid number instead of being dropped silently', async ({
  page,
}) => {
  await open(page, yaml);
  await page.locator('[data-outline-id="block-0-reg-0"]').click();
  const before = await docText(page);

  await page.locator('td[data-col-key="reset"]').first().dblclick();
  await page.locator('input[data-edit-key="reset"]').first().fill('A');

  await expect(page.locator('.vscode-error').first()).toHaveText('Invalid number');
  expect(await docText(page)).toBe(before);
});

test('$version typed in the value bar of a fieldless register is written in one update', async ({
  page,
}) => {
  await open(page, yaml);
  await postVersionContext(page);
  await page.locator('[data-outline-id="block-0-reg-1"]').click();
  const updatesBefore = await updateCount(page);

  const input = page.getByLabel('Register value (hex)');
  await input.click();
  await input.fill('$version');
  await expect(page.locator('.vscode-error')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  expect(await docText(page)).toMatch(/name: NO_FIELDS[\s\S]*resetValue: ["']?\$version["']?/);
  expect(await updateCount(page)).toBe(updatesBefore + 1);
  await expect(page.getByLabel('Register value (hex)')).toHaveValue('00010402');
  await expect(page.getByText('= $version')).toBeVisible();
});

test('without a version context the hint reads version unresolved', async ({ page }) => {
  await open(page, tokenYaml);
  await page.locator('[data-outline-id="block-0-reg-0"]').click();

  await expect(page.getByTestId('version-ref-hint')).toHaveText('version unresolved');
  await expect(page.getByLabel('Register value (hex)')).toHaveValue('00000000');
});

test('inserting the first bit field removes the register-level $version in the same update', async ({
  page,
}) => {
  await open(page, fieldlessRefYaml);
  await postVersionContext(page);
  await page.locator('[data-outline-id="block-0-reg-0"]').click();
  await expect(page.getByTestId('version-issues')).toHaveCount(0);
  const updatesBefore = await updateCount(page);

  await page.getByTitle('Add first bit field').click();
  await expect(page.locator('tr[data-row-id]')).toHaveCount(1);
  await page.waitForTimeout(300);

  const register = registerOf(await docText(page));
  expect(register.fields).toHaveLength(1);
  expect(Object.prototype.hasOwnProperty.call(register, 'resetValue')).toBe(false);
  expect(await updateCount(page)).toBe(updatesBefore + 1);
  await expect(page.getByTestId('version-issues')).toHaveCount(0);
});

test('a value bar commit removes a leftover register-level $version in one update', async ({
  page,
}) => {
  await open(page, fieldsWithRefYaml);
  await postVersionContext(page);
  await page.locator('[data-outline-id="block-0-reg-0"]').click();
  await expect(page.getByTestId('version-issues')).toContainText(
    'Use $version.* on the fields instead of a register-level'
  );
  const updatesBefore = await updateCount(page);

  const input = page.getByLabel('Register value (hex)');
  await input.click();
  await input.fill('000000A5');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  const register = registerOf(await docText(page));
  expect(Object.prototype.hasOwnProperty.call(register, 'resetValue')).toBe(false);
  expect(register.fields[0].resetValue).toBe(0xa5);
  expect(await updateCount(page)).toBe(updatesBefore + 1);
  await expect(page.getByTestId('version-issues')).toHaveCount(0);
});

test('a component reference typed in the value bar of a register with fields points to the Reset cell', async ({
  page,
}) => {
  await open(page, fieldsWithRefYaml);
  await postVersionContext(page);
  await page.locator('[data-outline-id="block-0-reg-0"]').click();
  const before = await docText(page);

  const input = page.getByLabel('Register value (hex)');
  await input.click();
  await input.fill('$version.major');
  await expect(page.locator('div.vscode-error')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  await expect(page.locator('div.vscode-error').first()).toHaveText(
    "Enter $version.major in a bit field's Reset cell"
  );
  expect(await docText(page)).toBe(before);
});

test('any reference typed in the value bar of a fieldless register is written in one update', async ({
  page,
}) => {
  await open(page, yaml);
  await postVersionContext(page);
  await page.locator('[data-outline-id="block-0-reg-1"]').click();
  const updatesBefore = await updateCount(page);

  const input = page.getByLabel('Register value (hex)');
  await input.click();
  await input.fill('$version.crc16');
  await expect(page.locator('.vscode-error')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  expect(await docText(page)).toMatch(
    /name: NO_FIELDS[\s\S]*resetValue: ["']?\$version\.crc16["']?/
  );
  expect(await updateCount(page)).toBe(updatesBefore + 1);
  // 1.4.2 -> CRC-16/IBM-3740 over 01 04 02
  await expect(page.getByLabel('Register value (hex)')).toHaveValue('0000172A');
});
