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
const IP_SOURCE = 'examples/led_avmm/led_controller_avmm.ip.yml';

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

// LED_AVMM_CSR -> addressBlocks[0] "CSR" -> block-0; registers within it are
// VERSION(0), LED_PATTERN(1), EVENTS(2) -- see outlineIds.ts's block-N-reg-M
// convention and examples/led_avmm/led_controller_avmm.mm.yml.
export const shots: Shot[] = [
  {
    id: 'memorymap-editor',
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
