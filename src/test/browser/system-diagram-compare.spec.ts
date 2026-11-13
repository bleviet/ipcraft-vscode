import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { diffSystemGraphs } from '../../services/systemDiagram/diff/diffSystemGraphs';
import { readSystemDesign } from '../../services/systemDiagram/readSystemDesign';

const harnessPath = `file://${path.resolve(__dirname, 'system-diagram.html')}`;
const fixtures = path.resolve(__dirname, '../fixtures/system-design/diff');

function read(file: string) {
  return readSystemDesign(file, 'system.bd', fs.readFileSync(path.join(fixtures, file), 'utf8'))!;
}

test.describe('System diagram comparison', () => {
  test('lists the changes in the Changes tab and selects a block from a row', async ({ page }) => {
    const graph = read('zynq_gpio_current.bd');
    const compare = {
      baseLabel: 'HEAD',
      diff: diffSystemGraphs(read('zynq_gpio_base.bd'), graph),
    };
    await page.goto(harnessPath);
    await page.waitForFunction(() =>
      (window as unknown as { __vscodeMessages: Array<{ type: string }> }).__vscodeMessages.some(
        (message) => message.type === 'ready'
      )
    );
    await page.evaluate((data) => window.postMessage({ type: 'graph', ...data }, '*'), {
      graph,
      compare,
    });

    await expect(page.getByRole('tab', { name: /^Changes/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.getByRole('button', { name: 'vs HEAD' })).toBeVisible();
    await expect(page.getByText(/differ from HEAD\./)).toBeVisible();

    await page.getByRole('button', { name: 'Toggle Details' }).click();
    await page.getByRole('row').filter({ hasText: 'PCW_FPGA0_PERIPHERAL_FREQMHZ' }).click();
    await expect(
      page.getByRole('complementary', { name: 'Details' }).getByRole('heading', { name: 'sys_ps7' })
    ).toBeVisible();
  });
});
