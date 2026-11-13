import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import type { SystemGraphDiff } from '../../domain/systemGraphDiff';
import { diffSystemGraphs } from '../../services/systemDiagram/diff/diffSystemGraphs';
import { readSystemDesign } from '../../services/systemDiagram/readSystemDesign';

const harnessPath = `file://${path.resolve(__dirname, 'system-diagram.html')}`;
const fixtures = path.resolve(__dirname, '../fixtures/system-design/diff');

function read(file: string) {
  return readSystemDesign(file, 'system.bd', fs.readFileSync(path.join(fixtures, file), 'utf8'))!;
}

/** The fixture diff with the long names of a real design in its address rows and one block. */
function realisticNames(diff: SystemGraphDiff): SystemGraphDiff {
  const renames: [string, string][] = [
    ['sys_ps7/Data', 'framebuffer_reader/Data_m_axi_mm_video'],
    ['gpio_block/axi_gpio_1/S_AXI/Reg', 'ddr_controller/memmap/memaddr'],
    ['axi_gpio_0/S_AXI/Reg', 'ddr_controller/memmap/memaddr_old'],
    ['axis_data_fifo_0', 'interconnect_main_controller_0'],
  ];
  const text = renames.reduce(
    (json, [from, to]) => json.split(from).join(to),
    JSON.stringify(diff)
  );
  return JSON.parse(text) as SystemGraphDiff;
}

test.describe('System diagram comparison', () => {
  test('lists the changes in the Changes tab and selects a block from a row', async ({ page }) => {
    const graph = read('zynq_gpio_current.bd');
    const compare = {
      baseLabel: 'HEAD',
      currentLabel: 'sys/system.bd',
      canSwap: true,
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
    await expect(page.getByText(/ differ\.$/)).toBeVisible();
    await expect(page.getByRole('group', { name: 'Direction of the comparison' })).toContainText(
      'Base HEAD → Current system.bd'
    );
    await expect(page.getByRole('button', { name: 'Swap' })).toBeVisible();
    await expect(
      page.getByRole('row').filter({ hasText: 'sys_ps7/Data → gpio_block/axi_gpio_1/S_AXI/Reg' })
    ).toContainText('address changed');

    await page.getByRole('button', { name: 'Toggle Details' }).click();
    await page.getByRole('row').filter({ hasText: 'PCW_FPGA0_PERIPHERAL_FREQMHZ' }).click();
    await expect(
      page.getByRole('complementary', { name: 'Details' }).getByRole('heading', { name: 'sys_ps7' })
    ).toBeVisible();
  });

  test('lists a renamed block as one row with the differing characters marked', async ({
    page,
  }) => {
    const graph = read('zynq_gpio_rename_current.bd');
    const compare = {
      baseLabel: 'HEAD',
      currentLabel: 'sys/system.bd',
      canSwap: false,
      diff: diffSystemGraphs(read('zynq_gpio_rename_base.bd'), graph),
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

    const row = page.getByRole('row').filter({ hasText: '→ Renamed' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('axi_gpio_0');
    await expect(row.locator('.sd-mark')).toHaveText(['0', 'main']);
    await expect(page.getByRole('button', { name: 'Renamed', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  for (const size of [
    { width: 1500, height: 900, rows: 3 },
    { width: 900, height: 700, rows: 1 },
    { width: 700, height: 700, rows: 0 },
  ]) {
    test(`shows table rows under a sticky bar at ${size.width}x${size.height}`, async ({
      page,
    }) => {
      const dir = 'hardware/vivado/projects/nontrivial_mips/nontrivial_mips.srcs/sources_1/bd';
      const graph = read('zynq_gpio_current.bd');
      const compare = {
        baseLabel: `${dir}/nontrivial_mips/nontrivial_mips.1.bd`,
        currentLabel: `${dir}/nontrivial_mips/nontrivial_mips.3.bd`,
        canSwap: true,
        diff: realisticNames(diffSystemGraphs(read('zynq_gpio_base.bd'), graph)),
      };
      await page.setViewportSize({ width: size.width, height: size.height });
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
      await expect(page.getByRole('row').nth(1)).toBeVisible();

      const measure = () =>
        page.evaluate(() => {
          const region = document.querySelector('[aria-label="Bottom panel"]') as HTMLElement;
          const scroller = region.lastElementChild as HTMLElement;
          const area = scroller.getBoundingClientRect();
          const bar = scroller.querySelector('.sd-ubar')!.getBoundingClientRect();
          const head = scroller.querySelector('thead')!.getBoundingClientRect();
          const rows = [...scroller.querySelectorAll('tbody tr')].filter((row) => {
            const box = row.getBoundingClientRect();
            return box.top >= head.bottom - 0.5 && box.bottom <= area.bottom + 0.5;
          });
          return {
            rows: rows.length,
            tallest: Math.max(...rows.map((row) => row.getBoundingClientRect().height)),
            tallestAddress: Math.max(
              ...rows
                .filter((row) => row.children[1]?.textContent === 'Address map')
                .map((row) => row.getBoundingClientRect().height)
            ),
            pageScrolls:
              document.documentElement.scrollWidth > document.documentElement.clientWidth,
            tableScrolls: scroller.scrollWidth > scroller.clientWidth,
            barVisible: bar.top >= area.top - 0.5 && bar.bottom <= area.bottom,
            barHeight: bar.height,
            scrollTop: scroller.scrollTop,
          };
        });
      const before = await measure();
      if (size.rows > 0) {
        expect(before.rows).toBeGreaterThanOrEqual(size.rows);
      }
      expect(before.pageScrolls).toBe(false);
      // Base and Current must be in view without scrolling the table sideways.
      expect(before.tableScrolls).toBe(false);
      if (size.width >= 1500) {
        // Rows of one line. A port row whose Base holds several items may use two.
        expect(before.tallestAddress).toBeLessThanOrEqual(30);
        expect(before.tallest).toBeLessThanOrEqual(45);
      }
      test.info().annotations.push({
        type: `${size.width}x${size.height}`,
        description: `${before.rows} rows, tallest ${before.tallest}px (address ${before.tallestAddress}px), bar ${before.barHeight}px`,
      });
      expect(before.barVisible).toBe(true);

      await page.evaluate(() => {
        const region = document.querySelector('[aria-label="Bottom panel"]') as HTMLElement;
        const scroller = region.lastElementChild as HTMLElement;
        scroller.scrollTop = scroller.scrollHeight;
      });
      const after = await measure();
      expect(after.scrollTop).toBeGreaterThan(0);
      expect(after.barVisible).toBe(true);
      await expect(
        page.getByRole('group', { name: 'Direction of the comparison' })
      ).toBeInViewport();
      await expect(page.getByRole('group', { name: 'Direction of the comparison' })).toContainText(
        'nontrivial_mips.1.bd → Current nontrivial_mips.3.bd'
      );
    });
  }
});
