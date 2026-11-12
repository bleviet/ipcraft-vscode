import { expect, type Locator, type Page } from '@playwright/test';
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
  // Clocks and resets only decorates the level: no wire is added and no block moves.
  const clocks = page.getByRole('button', { name: 'Clocks and resets' });
  await clocks.click();
  await expect(clocks).toHaveAttribute('aria-pressed', 'true');
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

/** Draws a pointer at the centre of `target`, so a still frame shows where the user acts. */
async function showPointer(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) {
    throw new Error('showPointer: target is not visible');
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.evaluate(
    ([left, top]) => {
      document.getElementById('docs-pointer')?.remove();
      const pointer = document.createElement('div');
      pointer.id = 'docs-pointer';
      pointer.setAttribute(
        'style',
        `position:fixed;left:${left}px;top:${top}px;z-index:2147483647;pointer-events:none;`
      );
      pointer.innerHTML =
        '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M5 3l14 8.5-6.2 1.4L9.6 19z" fill="#ffffff" stroke="#0d1120" stroke-width="1.4" stroke-linejoin="round"/></svg>';
      document.body.appendChild(pointer);
    },
    [x - 5, y - 3] as const
  );
}

/**
 * Frames of the isolate walkthrough on the landing page: a busy level, one block
 * selected, its context menu, the isolated view, and the view one hop further out.
 */
function isolateFrame(frame: 1 | 2 | 3 | 4 | 5): (page: Page) => Promise<void> {
  return async (page) => {
    const block = page.locator('.react-flow__node[data-id="/jtag_uart"]');
    if (frame === 1) {
      await showPointer(page, block);
      return;
    }
    await block.click({ position: { x: 40, y: 12 } });
    if (frame === 2) {
      await showPointer(page, block);
      return;
    }
    await block.click({ button: 'right', position: { x: 40, y: 12 } });
    const isolate = page.getByRole('menuitem', { name: /^Isolate/ });
    if (frame === 3) {
      await showPointer(page, isolate);
      return;
    }
    await untilViewportChanges(page, () => isolate.click());
    const moreHops = page.getByRole('button', { name: 'More hops' });
    if (frame === 4) {
      await showPointer(page, moreHops);
      return;
    }
    await untilViewportChanges(page, () => moreHops.click());
    await showPointer(page, moreHops);
  };
}

/**
 * Frames of the hierarchy walkthrough: the top level, inside a hierarchy block,
 * a nested block expanded in place, and the breadcrumb back to the top.
 */
function hierarchyFrame(frame: 1 | 2 | 3 | 4 | 5): (page: Page) => Promise<void> {
  return async (page) => {
    const block = page.locator('.react-flow__node[data-id="/dsp_pipeline"]');
    if (frame === 1) {
      await showPointer(page, block);
      return;
    }
    await untilViewportChanges(page, () => block.dblclick());
    const expand = page.getByRole('button', { name: 'Expand coeff_bank in place' });
    if (frame === 2) {
      await showPointer(page, expand);
      return;
    }
    await expand.click();
    const collapse = page.getByRole('button', { name: 'Collapse coeff_bank' });
    await expect(collapse).toBeVisible();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Fit' }).click();
    await page.waitForTimeout(300);
    const top = page
      .getByRole('navigation', { name: 'Hierarchy' })
      .getByRole('button', { name: 'zynq_dma_system' });
    if (frame === 3) {
      await showPointer(page, collapse);
      return;
    }
    if (frame === 4) {
      await showPointer(page, top);
      return;
    }
    await untilViewportChanges(page, () => top.click());
    await showPointer(page, block);
  };
}

/** Frames of the unconnected-pins walkthrough: the toggle, the findings, and one finding opened. */
function unconnectedFrame(frame: 1 | 2 | 3): (page: Page) => Promise<void> {
  return async (page) => {
    const toggle = page.getByRole('button', { name: /^Unconnected pins/ });
    if (frame === 1) {
      await showPointer(page, toggle);
      return;
    }
    await untilViewportChanges(page, () => toggle.click());
    const row = page.getByRole('region', { name: 'Bottom panel' }).locator('tbody tr').first();
    await expect(row).toBeVisible();
    if (frame === 2) {
      await showPointer(page, row);
      return;
    }
    await untilViewportChanges(page, () => row.click());
    await showPointer(page, row);
  };
}

/** Frames of the export walkthrough: the Export image button, its options, and the Export button. */
function exportFrame(frame: 1 | 2 | 3): (page: Page) => Promise<void> {
  return async (page) => {
    const button = page.getByRole('button', { name: 'Export image' });
    if (frame === 1) {
      await showPointer(page, button);
      return;
    }
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Export image options' });
    if (frame === 2) {
      await showPointer(page, dialog.getByLabel('Format'));
      return;
    }
    await dialog.getByLabel('Area').selectOption('whole');
    await showPointer(page, dialog.getByRole('button', { name: 'Export', exact: true }));
  };
}

async function dragBetween(page: Page, from: Locator, to: Locator): Promise<void> {
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) {
    throw new Error('dragBetween: handle is not visible');
  }
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
  await page.mouse.up();
}

/**
 * Frames of the Data Inspector walkthrough on the landing page: two decoded words,
 * a Concat operator added from the library, each word wired in, and the result.
 */
function inspectFrame(frame: 1 | 2 | 3 | 4 | 5): (page: Page) => Promise<void> {
  return async (page) => {
    // Decode both words as setupSplitAddress does, then remove the example's
    // ready-made Concat step so the walkthrough starts from the two inputs alone.
    await page.getByRole('textbox', { name: 'Literal' }).fill("32'h0001_2000");
    await page.getByRole('button', { name: 'Decode ADDR_HI' }).click();
    await page.locator('.react-flow__node[data-id="addr-low"]').click();
    await page.getByLabel('ADDR_LO value').fill("32'h0000_3F00");
    await page.getByRole('button', { name: 'Decode ADDR_LO' }).click();
    await page.locator('.react-flow__node[data-id="address"]').click();
    await page.getByRole('button', { name: 'Delete selected components' }).click();
    await expect(page.locator('.di-flow-step')).toHaveCount(0);
    const addConcat = page.getByRole('button', { name: 'Add Concat draft' });
    if (frame === 1) {
      await showPointer(page, addConcat);
      return;
    }
    await addConcat.click();
    const step = page.locator('.di-flow-step');
    await expect(step).toHaveCount(1);
    // The draft lands on top of ADDR_LO; move it to the right of the two inputs.
    const title = await step.locator('strong').boundingBox();
    if (!title) {
      throw new Error('inspectFrame: the draft step is not visible');
    }
    await page.mouse.move(title.x + 10, title.y + 8);
    await page.mouse.down();
    await page.mouse.move(title.x + 80, title.y - 52, { steps: 12 });
    await page.mouse.up();
    const high = page.locator('.react-flow__node[data-id="addr-high"] .react-flow__handle');
    const low = page.locator('.react-flow__node[data-id="addr-low"] .react-flow__handle');
    const hiInput = page.getByLabel('hi input');
    const loInput = page.getByLabel('lo input');
    if (frame === 2) {
      await showPointer(page, high);
      return;
    }
    await dragBetween(page, high, hiInput);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    if (frame === 3) {
      await showPointer(page, hiInput);
      return;
    }
    await dragBetween(page, low, loInput);
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
    if (frame === 4) {
      await showPointer(page, loInput);
      return;
    }
    await step.click();
    await showPointer(page, step);
  };
}

const FRAMES = [1, 2, 3, 4, 5] as const;

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
  /** 'css' writes one image pixel per CSS pixel (smaller files, for animation frames). Default: device pixels. */
  scale?: 'css' | 'device';
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
    // The whole top level with every panel hidden, so nothing covers the diagram.
    id: 'system-diagram-level',
    harness: 'systemDiagram',
    source: SYSTEM_BD_SOURCE,
    viewport: { width: 1600, height: 640 },
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
  // Walkthrough frames for the landing page (docs/index.html); see isolateFrame and inspectFrame.
  ...FRAMES.map(
    (frame): Shot => ({
      id: `anim-isolate-${frame}`,
      harness: 'systemDiagram',
      source: SYSTEM_QSYS_SOURCE,
      viewport: { width: 1440, height: 800 },
      scale: 'css',
      setup: isolateFrame(frame),
    })
  ),
  ...FRAMES.map(
    (frame): Shot => ({
      id: `anim-hierarchy-${frame}`,
      harness: 'systemDiagram',
      source: SYSTEM_BD_SOURCE,
      viewport: { width: 1440, height: 800 },
      scale: 'css',
      setup: hierarchyFrame(frame),
    })
  ),
  ...([1, 2, 3] as const).map(
    (frame): Shot => ({
      id: `anim-unconnected-${frame}`,
      harness: 'systemDiagram',
      source: SYSTEM_QSYS_SOURCE,
      viewport: { width: 1440, height: 800 },
      scale: 'css',
      setup: unconnectedFrame(frame),
    })
  ),
  ...([1, 2, 3] as const).map(
    (frame): Shot => ({
      id: `anim-export-${frame}`,
      harness: 'systemDiagram',
      source: SYSTEM_BD_SOURCE,
      viewport: { width: 1440, height: 800 },
      scale: 'css',
      setup: exportFrame(frame),
    })
  ),
  ...FRAMES.map(
    (frame): Shot => ({
      id: `anim-inspect-${frame}`,
      harness: 'dataInspector',
      source: DATA_INSPECTOR_SPLIT_SOURCE,
      viewport: { width: 1280, height: 800 },
      scale: 'css',
      setup: inspectFrame(frame),
    })
  ),
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
