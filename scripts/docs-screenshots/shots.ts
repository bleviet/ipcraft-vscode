import type { Page } from '@playwright/test';
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
  /** Repo-relative path to the YAML rendered into the harness. */
  source: string;
  /** Only meaningful for the ipcore harness -- see IpCoreApp.tsx's 'update' handler. */
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
