import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { openHarness } from '../docs-screenshots/harness';

// Developer tool, not a CI gate: loads a large system design in the system
// viewer harness and prints, for each user action, the main-thread cost
// (Chrome Performance.getMetrics) and the long tasks (over 50 ms).
// Run with `npm run perf:system-viewer` (builds the webview in production mode).

const FIXTURE_DIR = path.resolve(__dirname, '../../src/test/fixtures/system-design/generated');
const OUTPUT_DIR = path.resolve(__dirname, '../../test-results/perf');
const FIXTURES = ['vivado_dsp_soc_64ch.tcl', 'vivado_dsp_soc_8ch.tcl'];

interface Row {
  action: string;
  scriptMs: number;
  styleMs: number;
  layoutMs: number;
  longTasks: number;
  longestMs: number;
}

test.setTimeout(180000);

for (const fileName of FIXTURES) {
  test(`system viewer performance: ${fileName}`, async ({ page }) => {
    const rows: Row[] = [];
    await page.addInitScript(() => {
      const w = window as unknown as { __long: number[] };
      w.__long = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          w.__long.push(entry.duration);
        }
      }).observe({ type: 'longtask', buffered: true });
    });

    await openHarness(page, {
      harness: 'systemDiagram',
      theme: 'light',
      yamlText: fs.readFileSync(path.join(FIXTURE_DIR, fileName), 'utf8'),
      fileName,
      viewport: { width: 1600, height: 900 },
    });
    await page.waitForSelector('.react-flow__node', { timeout: 120000 });
    await page.waitForTimeout(500);

    const counts = await page.evaluate(() => ({
      nodes: document.querySelectorAll('.react-flow__node').length,
      edges: document.querySelectorAll('.react-flow__edge').length,
      dom: document.querySelectorAll('*').length,
    }));

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async (): Promise<Record<string, number>> =>
      Object.fromEntries(
        (await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value])
      );

    const measure = async (action: string, run: () => Promise<void>): Promise<void> => {
      await page.evaluate(() => ((window as unknown as { __long: number[] }).__long = []));
      const before = await metrics();
      await run();
      await page.waitForTimeout(300);
      const after = await metrics();
      const delta = (key: string): number => Math.round((after[key] - before[key]) * 1000);
      const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
      rows.push({
        action,
        scriptMs: delta('ScriptDuration'),
        styleMs: delta('RecalcStyleDuration'),
        layoutMs: delta('LayoutDuration'),
        longTasks: long.length,
        longestMs: Math.round(Math.max(0, ...long)),
      });
    };

    const frames = (): Promise<unknown> =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );

    const box = page.getByRole('searchbox', { name: 'Search instances' });
    await box.focus();
    for (const ch of ['c', 'h', '1', '2']) {
      await measure(`search keystroke "${ch}"`, async () => {
        await page.keyboard.type(ch);
        await frames();
      });
    }
    await measure('search Enter (next match)', async () => {
      await box.press('Enter');
      await page.waitForTimeout(200);
    });
    await measure('search Escape (clear)', async () => {
      await box.press('Escape');
    });

    const select = async (): Promise<void> => {
      const id = await page.evaluate(() => {
        for (const node of Array.from(document.querySelectorAll('.react-flow__node'))) {
          const r = node.getBoundingClientRect();
          if (r.left > 50 && r.top > 80 && r.right < 1500 && r.bottom < 850) {
            return node.getAttribute('data-id');
          }
        }
        return null;
      });
      const rect = (await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox())!;
      await page.mouse.click(rect.x + rect.width / 2, rect.y + 8);
    };
    await measure('select a block', select);

    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    const cx = pane.x + pane.width / 2;
    const cy = pane.y + pane.height / 2;
    const wheel = async (deltaY: number): Promise<void> => {
      await page.mouse.move(cx, cy);
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, deltaY);
        await page.waitForTimeout(30);
      }
    };
    const simplify = page.getByRole('button', { name: 'Simplify zoomed out' });
    await measure('10 wheel zoom-out steps, Simplify on', () => wheel(120));
    await measure('10 wheel zoom-in steps, Simplify on', () => wheel(-120));
    await simplify.click();
    await measure('10 wheel zoom-out steps, Simplify off', () => wheel(120));
    await measure('10 wheel zoom-in steps, Simplify off', () => wheel(-120));
    await simplify.click();

    await measure('drag pan (20 moves)', async () => {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(cx - i * 20, cy);
      }
      await page.mouse.up();
    });
    await measure('Fit', async () => {
      await page.getByRole('button', { name: 'Fit' }).click();
      await page.waitForTimeout(400);
    });

    const pad = (text: string, n: number): string => text.padEnd(n);
    const lines = [
      `${fileName}: ${counts.nodes} nodes, ${counts.edges} edges, ${counts.dom} DOM elements`,
      `${pad('action', 40)} script  style  layout  longtasks  longest`,
      ...rows.map(
        (r) =>
          `${pad(r.action, 40)} ${String(r.scriptMs).padStart(5)}  ${String(r.styleMs).padStart(5)}  ${String(r.layoutMs).padStart(6)}  ${String(r.longTasks).padStart(9)}  ${String(r.longestMs).padStart(7)}`
      ),
    ];

    console.log(`\n${lines.join('\n')}\n(times in ms)`);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${fileName.replace(/\.tcl$/, '')}.json`),
      JSON.stringify({ fileName, counts, rows }, null, 2)
    );
  });
}
