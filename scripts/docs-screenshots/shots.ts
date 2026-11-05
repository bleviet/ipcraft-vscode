import { expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import * as YAML from 'yaml';
import type { HarnessKind } from './harness';

const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_VIEWPORT = { width: 1400, height: 900 };

// Real, hardware-validated example (examples/led_avmm) rather than the
// deliberately minimal src/test/fixtures/ files, so screenshots and the
// tutorials that already walk through this design describe the same thing.
const MM_SOURCE = 'examples/led_avmm/led_controller_avmm.mm.yml';
const GENERAL_MM_SOURCE = 'ipcraft-spec/examples/comprehensive_axi/comprehensive_axi.mm.yml';
const IP_SOURCE = 'examples/led_avmm/led_controller_avmm.ip.yml';
const COMPREHENSIVE_IP_SOURCE = 'ipcraft-spec/examples/comprehensive_axi/comprehensive_axi.ip.yml';
const DATA_INSPECTOR_SPLIT_SOURCE = 'ipcraft-spec/examples/data_inspector/split_address.ipci.yml';
const DATA_INSPECTOR_STATUS_SOURCE =
  'ipcraft-spec/examples/data_inspector/comprehensive_axi_status.ipci.yml';

const SYSTEM_BD_SOURCE = 'src/test/fixtures/system-design/zynq_dma_system.tcl';
const SYSTEM_QSYS_SOURCE = 'src/test/fixtures/system-design/niosv_hps_system.tcl';

const VIEWPORT_SELECTOR = '.react-flow__viewport';

async function viewportTransform(page: Page): Promise<string> {
  return page
    .locator(VIEWPORT_SELECTOR)
    .evaluate((element) => (element as HTMLElement).style.transform);
}

/** Runs a gesture, then waits until it has moved the React Flow viewport. */
async function untilViewportChanges(page: Page, gesture: () => Promise<void>): Promise<void> {
  const before = await viewportTransform(page);
  await gesture();
  await page.waitForFunction(
    ([selector, previous]) =>
      (document.querySelector(selector) as HTMLElement | null)?.style.transform !== previous,
    [VIEWPORT_SELECTOR, before] as const,
    { timeout: 15000 }
  );
}

async function setupSystemOverview(page: Page): Promise<void> {
  await untilViewportChanges(page, () =>
    page.getByRole('button', { name: 'Toggle Outline' }).click()
  );
  await untilViewportChanges(page, () =>
    page.getByRole('button', { name: 'Toggle Details' }).click()
  );
  // Widen the details panel (16 px per key) so long net names are not clipped.
  const handle = page.getByRole('separator', { name: 'Resize Details' });
  await handle.focus();
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press('ArrowLeft');
  }
  await expect(handle).toHaveAttribute('aria-valuenow', '544');
  // Zoom in first so block text is readable, then select from the outline,
  // which centers the block at the current zoom.
  for (let i = 0; i < 7; i += 1) {
    await untilViewportChanges(page, () => page.getByRole('button', { name: 'Zoom in' }).click());
  }
  await untilViewportChanges(page, () =>
    page
      .getByRole('navigation', { name: 'Design outline' })
      .getByText('axi_dma_0', { exact: true })
      .click()
  );
}

async function setupSystemHierarchy(page: Page): Promise<void> {
  await untilViewportChanges(page, () =>
    page.locator('.react-flow__node[data-id="/dsp_pipeline"]').dblclick()
  );
  const edges = page.locator('.react-flow__edge');
  const before = await edges.count();
  await page.getByText('Clocks and resets').click();
  await expect.poll(() => edges.count()).toBeGreaterThan(before);
  // Fit after the clock and reset nets changed the layout.
  await untilViewportChanges(page, () => page.getByRole('button', { name: 'Fit' }).click());
}

async function setupSystemAddressMap(page: Page): Promise<void> {
  await untilViewportChanges(page, () =>
    page.getByRole('button', { name: 'Toggle Bottom Panel' }).click()
  );
  await page.getByRole('tab', { name: /Address map/ }).click();
}

async function setupSystemHover(page: Page): Promise<void> {
  const node = page.locator('.react-flow__node[data-id="/axi_dma_0"]');
  await untilViewportChanges(page, () => node.dblclick({ position: { x: 20, y: 10 } }));
  // One step back so the neighbouring blocks stay inside the frame.
  await untilViewportChanges(page, () => page.getByRole('button', { name: 'Zoom out' }).click());
  await node.getByText('S_AXI_LITE', { exact: true }).hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
}

async function setupSplitAddress(page: Page): Promise<void> {
  await page.getByRole('textbox', { name: 'Literal' }).fill("32'h0001_2000");
  await page.getByRole('button', { name: 'Decode ADDR_HI' }).click();
  await page.locator('.react-flow__node[data-id="addr-low"]').click();
  await page.getByLabel('ADDR_LO value').fill("32'h0000_3F00");
  await page.getByRole('button', { name: 'Decode ADDR_LO' }).click();
  await page.locator('.react-flow__node[data-id="address"]').click();
}

export interface Shot {
  /** Output basename -> docs/images/<id>-{dark,light}.png */
  id: string;
  harness: HarnessKind;
  /** Repo-relative path to the file rendered into the harness (YAML, or the design file for systemDiagram). */
  source: string;
  /** ipcore: see IpCoreApp.tsx's 'update' handler. systemDiagram: the design file name, which selects the reader. */
  fileName?: string;
  /** Repo-relative path to a .mm.yml this .ip.yml imports (memoryMaps.import).
   *  Without it, a bus interface's memoryMapRef fails reference validation
   *  and the editor shows a false "unknown memory map" error banner. */
  mmImportSource?: string;
  viewport?: { width: number; height: number };
  /** Selector to capture instead of the full page. */
  clip?: string;
  /** Clicks/expansion to run after the harness has real content, before capture. */
  setup?: (page: Page) => Promise<void>;
}

// Outline IDs follow block-N-reg-M (see outlineIds.ts). In the comprehensive
// AXI example, CTRL is block-0-reg-1.
export const shots: Shot[] = [
  {
    id: 'memorymap-editor',
    harness: 'memorymap',
    source: GENERAL_MM_SOURCE,
    viewport: DEFAULT_VIEWPORT,
    setup: async (page) => {
      await page.locator('[data-outline-id="block-0-reg-1"]').click(); // CTRL
    },
  },
  {
    id: 'memorymap-responsive-wide',
    harness: 'memorymap',
    source: GENERAL_MM_SOURCE,
    viewport: { width: 1000, height: 800 },
    setup: async (page) => {
      await page.locator('[data-outline-id="block-0-reg-1"]').click(); // CTRL
    },
  },
  {
    id: 'memorymap-responsive-narrow',
    harness: 'memorymap',
    source: GENERAL_MM_SOURCE,
    viewport: { width: 600, height: 800 },
  },
  {
    id: 'ipcore-editor',
    harness: 'ipcore',
    source: IP_SOURCE,
    fileName: 'led_controller_avmm.ip.yml',
    mmImportSource: MM_SOURCE,
    viewport: DEFAULT_VIEWPORT,
  },
  {
    id: 'ipcore-toolbar',
    harness: 'ipcore',
    source: IP_SOURCE,
    fileName: 'led_controller_avmm.ip.yml',
    mmImportSource: MM_SOURCE,
    viewport: DEFAULT_VIEWPORT,
    clip: 'div.flex.items-start.gap-2:has(button[aria-label="Undo"])',
  },
  {
    id: 'custom-interface-conduit',
    harness: 'ipcore',
    source: COMPREHENSIVE_IP_SOURCE,
    fileName: 'comprehensive_axi.ip.yml',
    mmImportSource: GENERAL_MM_SOURCE,
    viewport: DEFAULT_VIEWPORT,
    setup: async (page) => {
      await page.locator('.canvas-bus-bundle__name').filter({ hasText: 'DBG' }).click();
    },
  },
  {
    id: 'staging-overlay',
    harness: 'ipcore',
    source: IP_SOURCE,
    fileName: 'led_controller_avmm.ip.yml',
    mmImportSource: MM_SOURCE,
    viewport: DEFAULT_VIEWPORT,
    // Drives the ipcore webview's stagingStart handler directly -- see
    // IpCoreApp.tsx's message switch -- the same way WebviewStagingBridge.ts
    // does after a real Scaffold Project run. No extension host round trip.
    clip: '.canvas-inspector',
    setup: async (page) => {
      await page.evaluate(() => {
        window.postMessage(
          {
            type: 'stagingStart',
            rootLabel: 'led_controller_avmm',
            files: [
              { relativePath: 'rtl/led_controller_avmm_pkg.vhd', status: 'new', protected: false },
              { relativePath: 'rtl/led_controller_avmm.vhd', status: 'new', protected: false },
              {
                relativePath: 'rtl/led_controller_avmm_core.vhd',
                status: 'modified',
                protected: true,
              },
              {
                relativePath: 'rtl/led_controller_avmm_avmm.vhd',
                status: 'modified',
                protected: false,
              },
              {
                relativePath: 'rtl/led_controller_avmm_regs.vhd',
                status: 'unchanged',
                protected: false,
              },
              { relativePath: 'tb/led_controller_avmm_test.py', status: 'new', protected: false },
            ],
          },
          '*'
        );
      });
    },
  },
  {
    id: 'scaffold-template-picker',
    harness: 'ipcore',
    source: IP_SOURCE,
    fileName: 'led_controller_avmm.ip.yml',
    mmImportSource: MM_SOURCE,
    viewport: DEFAULT_VIEWPORT,
    // Scopes to the toolbar's ToolbarGroup wrapper via the dropdown's unique
    // aria-label -- see IpCoreApp.tsx's Scaffold pack <select> (no unique
    // class of its own; the ToolbarGroup div class is shared by every group).
    clip: '.flex.flex-col.items-center.gap-0\\.5:has(select[aria-label="Scaffold pack"])',
  },
  {
    id: 'consistency-findings',
    harness: 'ipcore',
    source: IP_SOURCE,
    fileName: 'led_controller_avmm.ip.yml',
    mmImportSource: MM_SOURCE,
    viewport: DEFAULT_VIEWPORT,
    // Drives IpCoreApp.tsx's 'consistencyResult' handler directly, the same
    // message IpCoreEditorProvider.ts sends after a real cross-check run.
    // findings.length > 0 auto-opens the ConsistencyOverlay (both share the
    // .canvas-inspector wrapper with StagingOverlay).
    clip: '.canvas-inspector',
    setup: async (page) => {
      await page.evaluate(() => {
        window.postMessage(
          {
            type: 'consistencyResult',
            auto: false,
            summary: { added: 1, removed: 0, changed: 1 },
            findings: [
              {
                kind: 'extra-port',
                message: "HDL declares 'o_status[3:0]' but the spec has no matching port",
                ipYmlPath: ['ports'],
                hdlFile: 'led_controller_avmm.vhd',
                hdlEntity: 'led_controller_avmm',
                severity: 'amber',
                source: 'hdl',
                inferred: { name: 'o_status', direction: 'out', width: 4 },
              },
              {
                kind: 'width-mismatch',
                message: "Port 'o_led' is 1 bit in the spec but 8 bits in the HDL",
                ipYmlPath: ['ports', 2],
                hdlFile: 'led_controller_avmm.vhd',
                hdlEntity: 'led_controller_avmm',
                severity: 'amber',
                source: 'hdl',
              },
            ],
          },
          '*'
        );
      });
    },
  },
  {
    id: 'system-diagram-overview',
    harness: 'systemDiagram',
    source: SYSTEM_BD_SOURCE,
    viewport: { width: 1600, height: 900 },
    setup: setupSystemOverview,
  },
  {
    id: 'system-diagram-hierarchy',
    harness: 'systemDiagram',
    source: SYSTEM_BD_SOURCE,
    viewport: DEFAULT_VIEWPORT,
    setup: setupSystemHierarchy,
  },
  {
    id: 'system-diagram-platform-designer',
    harness: 'systemDiagram',
    source: SYSTEM_QSYS_SOURCE,
    viewport: DEFAULT_VIEWPORT,
    setup: setupSystemAddressMap,
  },
  {
    id: 'system-diagram-hover',
    harness: 'systemDiagram',
    source: SYSTEM_BD_SOURCE,
    viewport: DEFAULT_VIEWPORT,
    clip: '.react-flow',
    setup: setupSystemHover,
  },
  {
    id: 'data-inspector-workspace',
    harness: 'dataInspector',
    source: DATA_INSPECTOR_SPLIT_SOURCE,
    viewport: { width: 1600, height: 1000 },
    setup: setupSplitAddress,
  },
  {
    id: 'data-inspector-bit-visualizer',
    harness: 'dataInspector',
    source: DATA_INSPECTOR_SPLIT_SOURCE,
    viewport: { width: 1600, height: 1000 },
    clip: '.di-ribbon-card',
    setup: async (page) => {
      await setupSplitAddress(page);
      await page.locator('.di-ribbon-card').evaluate((element) => {
        element.setAttribute('style', `${element.getAttribute('style') ?? ''};height:230px`);
      });
    },
  },
  {
    id: 'data-inspector-operator-library',
    harness: 'dataInspector',
    source: DATA_INSPECTOR_SPLIT_SOURCE,
    viewport: { width: 1600, height: 1000 },
    clip: '.di-library',
    setup: async (page) => {
      await setupSplitAddress(page);
      await page.locator('.di-library').evaluate((element) => {
        element.setAttribute('style', `${element.getAttribute('style') ?? ''};height:600px`);
      });
    },
  },
  {
    id: 'data-inspector-fields',
    harness: 'dataInspector',
    source: DATA_INSPECTOR_STATUS_SOURCE,
    viewport: { width: 1600, height: 1000 },
    clip: '.di-field-table',
    setup: async (page) => {
      await page.getByRole('textbox', { name: 'Literal' }).fill("32'h0003_1211");
      await page.getByRole('button', { name: 'Decode STATUS' }).click();
      await page.getByRole('tab', { name: /Fields/ }).click();
    },
  },
  {
    id: 'data-inspector-capture',
    harness: 'dataInspector',
    source: DATA_INSPECTOR_STATUS_SOURCE,
    viewport: { width: 1600, height: 1000 },
    clip: '.di-capture-panel details:nth-of-type(2)',
    setup: async (page) => {
      await page.getByRole('textbox', { name: 'Literal' }).fill("32'h0000_0000");
      await page.getByRole('button', { name: 'Decode STATUS' }).click();
      await page.getByRole('tab', { name: 'Capture' }).click();
      await page
        .getByLabel('CSV file')
        .setInputFiles(
          path.join(REPO_ROOT, 'docs/how-to/examples/data-inspector/generic-status.csv')
        );
      await page.getByLabel('Signal column').selectOption('STATUS');
    },
  },
];

export function readShotSource(shot: Shot): string {
  return fs.readFileSync(path.join(REPO_ROOT, shot.source), 'utf-8');
}

export function readShotMemoryMapImports(shot: Shot): unknown[] | undefined {
  if (!shot.mmImportSource) {
    return undefined;
  }
  const text = fs.readFileSync(path.join(REPO_ROOT, shot.mmImportSource), 'utf-8');
  const parsed = YAML.parse(text) as unknown;
  return Array.isArray(parsed) ? parsed : [parsed];
}
