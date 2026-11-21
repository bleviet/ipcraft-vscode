import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import type { DiagramResources } from '../../shared/messages/systemDiagram';
import { mapHierarchyReport } from '../../services/resources/mapReportToGraph';
import { readVivadoFlat } from '../../services/resources/resourceMetrics';
import { parseVivadoHierarchy } from '../../services/resources/vivadoHierarchyTable';
import { readSystemDesign } from '../../services/systemDiagram/readSystemDesign';

const harnessPath = `file://${path.resolve(__dirname, 'system-diagram.html')}`;
const fixtures = path.resolve(__dirname, '../fixtures/reports/vivado/spike');
const text = (file: string) => fs.readFileSync(path.join(fixtures, file), 'utf8');

const graph = readSystemDesign('sys.bd', 'sys.bd', text('sys.bd'))!;
const report = mapHierarchyReport(
  {
    table: parseVivadoHierarchy(text('routed_hier.rpt')),
    vendor: 'vivado',
    stage: 'routed',
    source: { fileName: 'routed_hier.rpt' },
    capacity: readVivadoFlat(text('routed_flat.rpt')).capacity,
  },
  graph
);
const resources: DiagramResources = {
  sources: [
    {
      id: 'impl',
      label: 'Post-route (impl_1)',
      vendor: 'vivado',
      stage: 'routed',
      origin: 'project',
      fileName: 'routed_hier.rpt',
      usable: true,
    },
  ],
  selected: 'impl',
  report,
  searched: ['sys.runs/impl_1'],
  hierarchicalTcl: 'report_utilization -hierarchical -file util.rpt',
};
const synthReport = mapHierarchyReport(
  {
    table: parseVivadoHierarchy(text('synth_hier.rpt')),
    vendor: 'vivado',
    stage: 'synth',
    source: { fileName: 'synth_hier.rpt' },
  },
  graph
);
const checkpoint = {
  id: 'ck',
  label: 'Post-route (impl_1)',
  vendor: 'vivado' as const,
  stage: 'routed' as const,
  origin: 'project' as const,
  fileName: 'sys.runs/impl_1/top_routed.dcp',
  usable: false,
  extractable: true as const,
  reason: 'Extract the report from the checkpoint.',
};
const synthSource = {
  id: 'synth',
  label: 'Post-synthesis (synth_1)',
  vendor: 'vivado' as const,
  stage: 'synth' as const,
  origin: 'project' as const,
  fileName: 'synth_hier.rpt',
  usable: true,
};
const noReport: DiagramResources = {
  sources: [],
  searched: ['sys.runs/impl_1', 'sys.runs/synth_1'],
  hierarchicalTcl: resources.hierarchicalTcl,
};

type Posted = { type: string };

async function open(page: Page) {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto(harnessPath);
  await page.waitForFunction(() =>
    (window as unknown as { __vscodeMessages: Posted[] }).__vscodeMessages.some(
      (message) => message.type === 'ready'
    )
  );
  await page.evaluate((data) => window.postMessage({ type: 'graph', graph: data }, '*'), graph);
  await expect(page.locator('.sd-node').first()).toBeVisible();
}

/**
 * The strip sits above the outer edge of its block's border (`block` is `.sd-node` or
 * `.sd-frame`) with the 2 px gap of the export, left aligned with that edge.
 */
async function expectClearOfBorder(strip: Locator, block: string) {
  const { gap, left } = await strip.evaluate((element, selector) => {
    const box = element.getBoundingClientRect();
    const outer = element.closest(selector)!.getBoundingClientRect();
    return { gap: outer.top - box.bottom, left: box.left - outer.left };
  }, block);
  expect(gap).toBeGreaterThanOrEqual(1.5);
  expect(gap).toBeLessThanOrEqual(2.5);
  expect(Math.abs(left)).toBeLessThan(0.5);
}

const posted = (page: Page, type: string) =>
  page.evaluate(
    (wanted) =>
      (window as unknown as { __vscodeMessages: Posted[] }).__vscodeMessages.filter(
        (message) => message.type === wanted
      ).length,
    type
  );

const postedMessages = (page: Page, type: string) =>
  page.evaluate(
    (wanted) =>
      (window as unknown as { __vscodeMessages: Posted[] }).__vscodeMessages.filter(
        (message) => message.type === wanted
      ),
    type
  );

const sendResources = (page: Page, value: DiagramResources) =>
  page.evaluate((data) => window.postMessage({ type: 'resources', resources: data }, '*'), value);

const block = (page: Page, name: string) =>
  page.locator('.sd-node', { has: page.locator('.sd-node-name', { hasText: name }) });

const boxes = (page: Page) =>
  page.locator('.sd-node').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return [
        node.querySelector('.sd-node-name')?.textContent,
        box.x,
        box.y,
        box.width,
        box.height,
      ];
    })
  );

const toggle = (page: Page) => page.getByRole('button', { name: 'Resources', exact: true });

test.describe('System diagram resources', () => {
  test('asks for the reports once, and shows the usage in the headers without moving a block', async ({
    page,
  }) => {
    await open(page);
    const before = await boxes(page);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    expect(await posted(page, 'loadResources')).toBe(0);
    await expect(block(page, 'axi_bram_ctrl_0')).not.toContainText('LUTs');

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await posted(page, 'loadResources')).toBe(1);
    await sendResources(page, resources);

    const header = block(page, 'axi_bram_ctrl_0').locator('.sd-node-head');
    const strip = header.locator('.sd-node-usage');
    await expect(strip).toBeVisible();
    for (const figure of ['154 LUT', '168 FF', '0 BRAM', '0 DSP']) {
      await expect(strip).toContainText(figure);
    }
    await expect(strip).toContainText('18.3 % design');
    // The subtitle keeps the block type; the tooltip has the full figures.
    await expect(header.locator('.sd-node-subtitle')).not.toContainText('LUT');
    await expect(header.locator('.sd-node-subtitle')).toHaveAttribute(
      'title',
      /^Post-route: LUTs 154/
    );
    await expect(header.locator('.sd-node-share')).toBeAttached();
    // Not clipped by the node, a node wrapper, or the canvas.
    const placed = await strip.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const clipped = [];
      for (let up = element.parentElement; up; up = up.parentElement) {
        const style = getComputedStyle(up);
        const clips = [style.overflowX, style.overflowY].some((value) => value !== 'visible');
        const outer = up.getBoundingClientRect();
        if (
          clips &&
          (box.left < outer.left - 0.5 ||
            box.right > outer.right + 0.5 ||
            box.top < outer.top - 0.5 ||
            box.bottom > outer.bottom + 0.5)
        ) {
          clipped.push(up.className);
        }
      }
      return { clipped };
    });
    expect(placed.clipped).toEqual([]);
    await expectClearOfBorder(strip, '.sd-node');
    expect(await boxes(page)).toEqual(before);

    await toggle(page).click();
    await expect(strip).toHaveCount(0);
    await toggle(page).click();
    expect(await posted(page, 'loadResources')).toBe(1);
    expect(await boxes(page)).toEqual(before);

    // An expanded hierarchy block shows its strip too, and so do the blocks inside it.
    await page.getByRole('button', { name: 'Expand hier_0 in place' }).click();
    const frameStrip = page.locator('.sd-frame .sd-node-usage').first();
    await expect(frameStrip).toContainText('135 LUT');
    await expectClearOfBorder(frameStrip, '.sd-frame');
    await expect(block(page, 'bram_0').locator('.sd-node-usage')).toContainText('2 BRAM');
  });

  test('turns Resources on when the extension says to show it, without asking for the reports', async ({
    page,
  }) => {
    await open(page);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(
      (data) => window.postMessage({ type: 'resources', resources: data, show: true }, '*'),
      resources
    );
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(block(page, 'axi_bram_ctrl_0').locator('.sd-node-usage')).toContainText('154 LUT');
    expect(await posted(page, 'loadResources')).toBe(0);
    // Later messages without `show` leave the toggle alone.
    await toggle(page).click();
    await sendResources(page, resources);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('lists the blocks in the Resources tab and selects one from its row', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('tab', { name: /^Resources/ })).toHaveCount(0);
    await toggle(page).click();
    await sendResources(page, resources);

    await page.getByRole('button', { name: 'Toggle Bottom Panel' }).click();
    const tab = page.getByRole('tab', { name: /^Resources/ });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('combobox', { name: 'Report' })).toHaveValue('impl');
    for (const name of ['axi_bram_ctrl_0', 'smartconnect_0', 'hier_0', 'bram_0']) {
      await expect(page.getByRole('row').filter({ hasText: name }).first()).toBeVisible();
    }
    await expect(page.getByRole('row').last()).toContainText('841');

    await page.getByRole('button', { name: 'Toggle Details' }).click();
    await page.getByRole('row').filter({ hasText: 'smartconnect_0' }).click();
    const details = page.getByRole('complementary', { name: 'Details' });
    await expect(details.getByRole('heading', { name: 'smartconnect_0' })).toBeVisible();
    await expect(details.getByRole('heading', { name: 'Resources' })).toBeVisible();
    await expect(details).toContainText('Post-route · routed_hier.rpt');
    await expect(details.getByRole('row', { name: /^LUTs 422/ })).toBeVisible();
  });

  test('opens the tab from the toolbar chip, and falls back when Resources turns off', async ({
    page,
  }) => {
    await open(page);
    await toggle(page).click();
    await sendResources(page, resources);
    const chip = page.getByRole('button', { name: /^Open the Resources tab/ });
    await expect(chip).toHaveText('Post-route · 841 LUTs · 1.3 %');

    // The panel is collapsed: the chip expands it on the Resources tab.
    await chip.click();
    const tab = page.getByRole('tab', { name: /^Resources/ });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: /^Clocks/ }).click();
    await expect(tab).toHaveAttribute('aria-selected', 'false');
    await chip.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');

    await toggle(page).click();
    await expect(chip).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^Resources/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^Address map/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('offers the attach actions when there is no report', async ({ page }) => {
    await open(page);
    await toggle(page).click();
    await sendResources(page, noReport);
    await expect(page.getByRole('button', { name: /^Open the Resources tab/ })).toHaveText(
      'No report'
    );
    await page.getByRole('button', { name: 'Toggle Bottom Panel' }).click();
    await page.getByRole('tab', { name: /^Resources/ }).click();
    await expect(page.getByText('No resource report found for this design.')).toBeVisible();
    await expect(page.getByText('sys.runs/synth_1')).toBeVisible();
    await expect(page.locator('code')).toHaveText(resources.hierarchicalTcl);

    await page.getByRole('button', { name: 'Attach Report...' }).click();
    expect(await posted(page, 'attachResourceReport')).toBe(1);
    await page.getByRole('button', { name: 'Choose Folder...' }).click();
    expect(await posted(page, 'chooseResourceFolder')).toBe(1);
  });

  async function openResourcesTab(page: Page, value: DiagramResources) {
    await open(page);
    await toggle(page).click();
    await sendResources(page, value);
    await page.getByRole('button', { name: 'Toggle Bottom Panel' }).click();
    await page.getByRole('tab', { name: /^Resources/ }).click();
  }

  test('offers Extract for a checkpoint, posts the request, and shows the spinner while it runs', async ({
    page,
  }) => {
    const withCheckpoint: DiagramResources = {
      ...resources,
      sources: [...resources.sources, checkpoint],
      selected: 'ck',
      report: undefined,
    };
    await openResourcesTab(page, withCheckpoint);
    await expect(page.getByRole('combobox', { name: 'Report' }).locator('option')).toHaveText([
      'Post-route (impl_1)',
      'Post-route (impl_1) (checkpoint)',
    ]);
    await expect(page.getByText('(not usable)')).toHaveCount(0);

    const extract = page.getByRole('button', { name: 'Extract', exact: true });
    await expect(extract).toBeEnabled();
    await extract.click();
    expect(await postedMessages(page, 'extractResources')).toEqual([
      { type: 'extractResources', id: 'ck' },
    ]);

    await sendResources(page, { ...withCheckpoint, extracting: 'ck' });
    await expect(extract).toBeDisabled();
    await expect(extract.locator('.codicon-loading.codicon-modifier-spin')).toBeVisible();
  });

  test('names the missing IPs on the Extract button of the OOC group', async ({ page }) => {
    const ooc = {
      ...synthSource,
      id: 'ooc',
      label: 'Per-IP OOC (4 of 5 IPs)',
      stage: 'ooc' as const,
      extractable: true as const,
      missing: 1,
    };
    await openResourcesTab(page, { ...resources, sources: [ooc], selected: 'ooc' });
    await page.getByRole('button', { name: 'Extract missing IPs (1)' }).click();
    expect(await postedMessages(page, 'extractResources')).toEqual([
      { type: 'extractResources', id: 'ooc' },
    ]);
  });

  test('compares with another source: the select posts, Details shows two stages and the change', async ({
    page,
  }) => {
    const base: DiagramResources = { ...resources, sources: [...resources.sources, synthSource] };
    await openResourcesTab(page, base);
    const select = page.getByRole('combobox', { name: 'Compare with' });
    await expect(select.locator('option')).toHaveText(['None', 'Post-synthesis (synth_1)']);
    await select.selectOption('synth');
    expect(await postedMessages(page, 'compareResourceSource')).toEqual([
      { type: 'compareResourceSource', id: 'synth' },
    ]);

    await sendResources(page, { ...base, compare: { id: 'synth', report: synthReport } });
    await expect(select).toHaveValue('synth');
    await expect(page.getByText('Change against Post-synthesis (synth_1)')).toBeVisible();
    const tabRow = page
      .getByRole('region', { name: 'Bottom panel' })
      .getByRole('row')
      .filter({ hasText: 'smartconnect_0' });
    const comparedLut = synthReport.instances['/smartconnect_0'].total[0];
    const tabChange = 422 - comparedLut;
    await expect(tabRow.getByRole('cell').nth(2)).toHaveText(
      `422 (0.7 %) ${tabChange > 0 ? `+${tabChange}` : String(tabChange)}`
    );
    await page.getByRole('button', { name: 'Toggle Details' }).click();
    await page.getByRole('row').filter({ hasText: 'smartconnect_0' }).click();
    const details = page.getByRole('complementary', { name: 'Details' });
    await expect(details.getByRole('columnheader')).toContainText([
      'Metric',
      'Total (Post-route)',
      'Total (Post-synthesis)',
      'Change',
      'Self',
      '% of design',
      '% of device',
    ]);
    const luts = details.getByRole('row', { name: /^LUTs 422/ });
    await expect(luts).toBeVisible();
    const cells = await luts.getByRole('cell').allTextContents();
    const compared = synthReport.instances['/smartconnect_0'].total[0];
    const change = 422 - compared;
    expect(cells.slice(1, 4)).toEqual([
      '422',
      String(compared),
      change > 0 ? `+${change}` : String(change),
    ]);

    await select.selectOption('');
    expect((await postedMessages(page, 'compareResourceSource')).at(-1)).toEqual({
      type: 'compareResourceSource',
    });
    await sendResources(page, base);
    await expect(page.getByText(/Change against/)).toHaveCount(0);
    await expect(tabRow.getByRole('cell').nth(2)).toHaveText('422 (0.7 %)');
  });

  test('shows the shares of the design and of the device in the strip and the table, without options or moving a block', async ({
    page,
  }) => {
    await open(page);
    const before = await boxes(page);
    await toggle(page).click();
    await sendResources(page, resources);
    const strip = block(page, 'axi_bram_ctrl_0').locator('.sd-node-usage');
    await expect(strip.locator('> div')).toHaveText([
      '154 LUT · 168 FF · 0 BRAM · 0 DSP',
      '18.3 % design · 0.2 % device',
    ]);
    // Two lines of equal height, the second under the first, both inside the one background.
    const lines = await strip.locator('> div').evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { top: box.top, height: box.height, left: box.left };
      })
    );
    expect(lines).toHaveLength(2);
    expect(lines[1].top - lines[0].top).toBeCloseTo(lines[0].height, 0);
    expect(lines[1].left).toBeCloseTo(lines[0].left, 0);
    expect((await strip.boundingBox())!.height).toBeCloseTo(2 * lines[0].height, 0);
    await expectClearOfBorder(strip, '.sd-node');
    expect(await boxes(page)).toEqual(before);

    await page.getByRole('button', { name: 'Toggle Bottom Panel' }).click();
    await page.getByRole('tab', { name: /^Resources/ }).click();
    await expect(page.getByRole('combobox', { name: 'Show' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Color by' })).toHaveCount(0);
    await expect(page.getByRole('row').last()).toContainText('841 (1.3 %)');
    await expect(page.getByRole('row').last()).toContainText('100.0 %');
  });
});
