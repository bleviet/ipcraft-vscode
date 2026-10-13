/* eslint-disable */
// `$version` references in the Memory Map editor: typing a token in a field's reset cell, the
// resolved-value hint, the scheme diagnostics, and `$version` on a fieldless register via the
// value bar.
//
// Needs the real webview (postMessage round-trip + YAML write-back + the versionContext
// notification), so this runs in a browser against a stand-in for the extension host.
import { test, expect, type Page } from '@playwright/test';
import path from 'path';

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
    'Use $version, $version.major, $version.minor or $version.patch'
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
