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
// AXI example, CTRL is block-0-reg-1. In LED_AVMM_CSR, VERSION is register 0,
// LED_PATTERN is register 1, and EVENTS is register 2.
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
    id: 'led-memorymap-editor',
    harness: 'memorymap',
    source: MM_SOURCE,
    viewport: DEFAULT_VIEWPORT,
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
    id: 'outline-tree',
    harness: 'memorymap',
    source: MM_SOURCE,
    viewport: DEFAULT_VIEWPORT,
    clip: 'aside.sidebar',
  },
  {
    id: 'bitfield-visualizer',
    harness: 'memorymap',
    source: MM_SOURCE,
    viewport: DEFAULT_VIEWPORT,
    clip: 'main section',
    setup: async (page) => {
      await page.locator('[data-outline-id="block-0-reg-1"]').click(); // LED_PATTERN
    },
  },
  {
    id: 'fields-table-access',
    harness: 'memorymap',
    source: MM_SOURCE,
    viewport: DEFAULT_VIEWPORT,
    // The data-fields-table wrapper is flex-1/min-h-0 (stretches to fill its
    // panel), so clip the <table> itself for a tight crop around content.
    clip: '[data-fields-table="true"] table',
    setup: async (page) => {
      await page.locator('[data-outline-id="block-0-reg-2"]').click(); // EVENTS: write-1-to-clear + monitorChangeOf
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
