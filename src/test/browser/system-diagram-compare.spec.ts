import { expect, test, type Page } from '@playwright/test';
import type { SystemGraph } from '../../domain/systemGraph';
import type { DiagramCompare } from '../../shared/messages/systemDiagram';
import fs from 'fs';
import path from 'path';
import type { SystemGraphDiff } from '../../domain/systemGraphDiff';
import { diffFindings } from '../../services/systemDiagram/diff/diffFindings';
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
      findings: { new: [], resolved: [] },
      baseDefinitions: 'workspace',
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

  test('lists the findings that differ in the Findings tab', async ({ page }) => {
    const [base, graph] = [read('zynq_gpio_base.bd'), read('zynq_gpio_current.bd')];
    const diff = diffSystemGraphs(base, graph);
    const compare = {
      baseLabel: 'HEAD',
      currentLabel: 'sys/system.bd',
      canSwap: false,
      diff,
      findings: diffFindings(base, graph, diff),
      baseDefinitions: 'workspace',
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

    const tab = page.getByRole('tab', { name: /^Findings/ });
    await expect(tab).toHaveAccessibleName('Findings 1');
    // The Findings tab does not open by itself.
    await expect(page.getByRole('tab', { name: /^Changes/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await tab.click();
    await expect(page.getByText(/^Both sides are checked/)).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: 'undriven pin' });
    await expect(row).toContainText('Resolved');
    await expect(row).toContainText('led_o');
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
      findings: { new: [], resolved: [] },
      baseDefinitions: 'workspace',
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

  async function openComparing(
    page: Page,
    pair: [string, string],
    edit: (diff: SystemGraphDiff) => SystemGraphDiff = (diff) => diff
  ) {
    const graph = read(pair[1]);
    const compare = {
      baseLabel: 'HEAD',
      currentLabel: 'sys/system.bd',
      canSwap: false,
      diff: edit(diffSystemGraphs(read(pair[0]), graph)),
      findings: { new: [], resolved: [] },
      baseDefinitions: 'workspace',
    };
    await page.setViewportSize({ width: 1500, height: 900 });
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
    await expect(page.locator('.sd-node').first()).toBeVisible();
  }

  const block = (page: Page, name: string) =>
    page.locator('.sd-node', { has: page.locator('.sd-node-name', { hasText: name }) });

  test('marks an added and a changed block, and a new wire, on the diagram', async ({ page }) => {
    await openComparing(page, ['zynq_gpio_base.bd', 'zynq_gpio_current.bd']);

    const added = block(page, 'axis_data_fifo_0');
    await expect(added).toHaveAttribute('data-change', 'added');
    await expect(added.getByRole('img', { name: 'Added' })).toBeVisible();
    await expect(added.getByRole('img', { name: 'Added' })).toHaveText('+');
    const changed = block(page, 'sys_ps7');
    await expect(changed).toHaveAttribute('data-change', 'changed');
    await expect(changed.getByRole('img', { name: /^Changed/ })).toHaveText('~');
    await expect(block(page, 'axi_periph')).not.toHaveAttribute('data-change');
    await expect(
      block(page, 'gpio_block').getByRole('img', { name: '1 change inside' })
    ).toHaveText('~ 1 inside');
    // As drawn, with the space before the word.
    expect(await block(page, 'gpio_block').locator('.sd-change-inside').innerText()).toBe(
      '~ 1 inside'
    );
    await expect(page.locator('path.sd-edge-new').first()).toBeAttached();
    await expect(page.getByLabel('Legend')).toContainText('New wire');
    await expect(page.getByLabel('Legend')).toContainText('2 removed, see Changes');
  });

  test('marks the changed and removed segments in the Address map tab', async ({ page }) => {
    await openComparing(page, ['zynq_gpio_base.bd', 'zynq_gpio_current.bd']);
    await page.getByRole('tab', { name: /^Address map/ }).click();

    const changed = page.getByRole('row').filter({ hasText: 'gpio_block/axi_gpio_1/S_AXI/Reg' });
    await expect(changed.getByRole('cell').first()).toHaveText('~');
    await expect(changed.locator('td[data-changed="true"]').first()).toHaveAttribute(
      'title',
      'Base: 0x4121_0000'
    );
    const removed = page.getByRole('row').filter({ hasText: 'axi_gpio_0/S_AXI/Reg' });
    await expect(removed.getByRole('cell').first()).toHaveText('−');
    await expect(removed).toHaveAttribute('title', 'Not in this revision');
  });

  test('marks a renamed block with an arrow', async ({ page }) => {
    await openComparing(page, ['zynq_gpio_rename_base.bd', 'zynq_gpio_rename_current.bd']);
    const renamed = block(page, 'axi_gpio_main');
    await expect(renamed).toHaveAttribute('data-change', 'renamed');
    await expect(renamed.getByRole('img', { name: 'Renamed from axi_gpio_0' })).toHaveText('→');
    await expect(page.locator('path.sd-edge-new')).toHaveCount(0);
  });

  test('marks a changed pin in its color with a title', async ({ page }) => {
    await openComparing(page, ['zynq_gpio_base.bd', 'zynq_gpio_current.bd'], (diff) => ({
      ...diff,
      instances: diff.instances.map((i) =>
        i.path === '/sys_ps7'
          ? {
              ...i,
              pins: [
                {
                  pin: 'FCLK_CLK0',
                  status: 'changed' as const,
                  basePeers: [],
                  currentPeers: ['axi_periph/ACLK'],
                  gained: ['axi_periph/ACLK'],
                },
              ],
            }
          : i
      ),
    }));
    const pin = block(page, 'sys_ps7').locator('.sd-pin-label', { hasText: 'FCLK_CLK0' });
    await expect(pin).toHaveAttribute('data-change', 'changed');
    await expect(pin).toHaveAttribute('title', 'Connection changed');
    await expect(pin).toHaveCSS('font-weight', '600');
  });

  test('takes every mark away with Marks, and Changes only isolates and Show All restores', async ({
    page,
  }) => {
    await openComparing(page, ['zynq_gpio_base.bd', 'zynq_gpio_current.bd']);
    const marks = page.getByRole('button', { name: 'Marks' });
    await expect(marks).toHaveAttribute('aria-pressed', 'true');
    await marks.click();
    await expect(page.locator('[data-change]')).toHaveCount(0);
    await expect(page.locator('.sd-change-sign, .sd-change-inside, path.sd-edge-new')).toHaveCount(
      0
    );
    // The Changes tab stays.
    await expect(page.getByRole('tab', { name: /^Changes/ })).toBeVisible();
    await marks.click();
    await expect(block(page, 'sys_ps7')).toHaveAttribute('data-change', 'changed');

    const before = await page.locator('.sd-node').count();
    await page.getByRole('button', { name: 'Changes only' }).click();
    await expect(page.getByText(/^Isolated · /)).toBeVisible();
    await expect(page.locator('.sd-node')).not.toHaveCount(before);
    await expect(block(page, 'axis_data_fifo_0')).toBeVisible();
    await page.getByRole('button', { name: 'Show All' }).click();
    await expect(page.getByText(/^Isolated · /)).toHaveCount(0);
    await expect(page.locator('.sd-node')).toHaveCount(before);
  });

  /** The fixture design of the other tests with one more pin on the net `fclk` (a new branch of its tree). */
  function clockBranchPair() {
    const text = fs.readFileSync(
      path.resolve(__dirname, '../fixtures/system-design/zynq_gpio_system.bd'),
      'utf8'
    );
    const edit = (add: boolean) => {
      const root = JSON.parse(text) as { design: { nets: { fclk: { ports: string[] } } } };
      if (add) {
        root.design.nets.fclk.ports.push('axi_gpio_0/new_clk');
      }
      return readSystemDesign('x.bd', 'x.bd', JSON.stringify(root))!;
    };
    return [edit(false), edit(true)] as const;
  }

  async function post(page: Page, graph: SystemGraph, compare?: DiagramCompare) {
    await page.evaluate((data) => window.postMessage({ type: 'graph', ...data }, '*'), {
      graph,
      compare,
    });
  }

  async function openHarness(page: Page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.goto(harnessPath);
    await page.waitForFunction(() =>
      (window as unknown as { __vscodeMessages: Array<{ type: string }> }).__vscodeMessages.some(
        (message) => message.type === 'ready'
      )
    );
  }

  test('draws the shared trunk of a new clock branch as without the mark', async ({ page }) => {
    const [base, current] = clockBranchPair();
    await openHarness(page);
    await post(page, current, {
      baseLabel: 'HEAD',
      currentLabel: 'sys/system.bd',
      canSwap: false,
      diff: diffSystemGraphs(base, current),
      findings: { new: [], resolved: [] },
      baseDefinitions: 'workspace',
    });
    await expect(page.locator('.sd-node').first()).toBeVisible();
    const overlay = page.locator('path.sd-edge-new:not(.react-flow__edge-path)');
    await expect(overlay.first()).toBeAttached();
    const strokes = await overlay.evaluateAll((paths) =>
      paths.map((own) => ({
        own: own.getAttribute('stroke'),
        trunk: getComputedStyle(
          own.parentElement!.querySelector('.react-flow__edge-path') as Element
        ).stroke,
      }))
    );
    for (const { own, trunk } of strokes) {
      expect(own).toBe('var(--sd-change-added)');
      expect(trunk).not.toContain('sd-change-added');
    }
  });

  test('keeps the header of a hierarchy within its height with marks and the review on', async ({
    page,
  }) => {
    const graph = read('zynq_gpio_current.bd');
    await openHarness(page);
    const measure = () =>
      block(page, 'gpio_block').evaluate((node) => {
        const head = node.querySelector('.sd-node-head') as HTMLElement;
        const title = node.querySelector('.sd-node-title') as HTMLElement;
        const row = node.querySelector('.sd-pin-label') as HTMLElement;
        const box = node.getBoundingClientRect();
        return {
          box: [box.width, box.height],
          headH: head.getBoundingClientRect().height,
          scrollH: head.scrollHeight,
          titleBottom: title.getBoundingClientRect().bottom,
          rowTop: (row.closest('[aria-label],div') as HTMLElement).getBoundingClientRect().top,
        };
      });
    await post(page, graph);
    await page.getByRole('button', { name: /^Unconnected pins/ }).click();
    await expect(block(page, 'gpio_block')).toBeVisible();
    const plain = await measure();
    await post(page, graph, {
      baseLabel: 'HEAD',
      currentLabel: 'sys/system.bd',
      canSwap: false,
      diff: diffSystemGraphs(read('zynq_gpio_base.bd'), graph),
      findings: { new: [], resolved: [] },
      baseDefinitions: 'workspace',
    });
    await expect(
      block(page, 'gpio_block').getByRole('img', { name: '1 change inside' })
    ).toBeVisible();
    const marked = await measure();
    expect(marked.scrollH).toBeLessThanOrEqual(Math.ceil(marked.headH));
    expect(marked.titleBottom).toBeLessThanOrEqual(marked.rowTop);
    expect(marked.box).toEqual(plain.box);
    // The name stays on one line.
    const name = block(page, 'gpio_block').locator('.sd-node-name');
    expect((await name.boundingBox())!.height).toBeLessThan(20);
  });

  test('keeps the marks findable at a far zoom', async ({ page }) => {
    const graph = read('zynq_gpio_current.bd');
    await openHarness(page);
    await post(page, graph, {
      baseLabel: 'HEAD',
      currentLabel: 'sys/system.bd',
      canSwap: false,
      diff: diffSystemGraphs(read('zynq_gpio_base.bd'), graph),
      findings: { new: [], resolved: [] },
      baseDefinitions: 'workspace',
    });
    await expect(page.locator('.sd-node').first()).toBeVisible();
    const canvas = page.locator('.sd-canvas');
    for (let i = 0; i < 12 && (await canvas.getAttribute('data-far')) !== 'true'; i++) {
      await page.getByRole('button', { name: 'Zoom out' }).click();
      await page.waitForTimeout(150);
    }
    await expect(canvas).toHaveAttribute('data-far', 'true');
    await page.waitForTimeout(300);
    const far = await page.evaluate(() => {
      const viewport = document.querySelector('.react-flow__viewport') as HTMLElement;
      const zoom = new DOMMatrix(getComputedStyle(viewport).transform).a;
      const node = document.querySelector('.sd-node[data-change="added"]') as HTMLElement;
      const shadow = getComputedStyle(node).boxShadow;
      const px = [...shadow.split('),')[0].matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
      const sign = node.querySelector('.sd-change-sign') as HTMLElement;
      return { zoom, spread: px[3], signHeight: sign.getBoundingClientRect().height };
    });
    expect(far.zoom).toBeLessThan(0.42);
    expect(far.spread * far.zoom).toBeGreaterThanOrEqual(1.99);
    expect(far.signHeight).toBeGreaterThanOrEqual(8);
    // Far out the count keeps its number and drops the word.
    expect(await block(page, 'gpio_block').locator('.sd-change-inside').innerText()).toBe('~ 1');
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
        findings: { new: [], resolved: [] },
        baseDefinitions: 'workspace',
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
