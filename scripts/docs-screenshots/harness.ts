import type { Page } from '@playwright/test';
import path from 'path';

export type HarnessKind = 'memorymap' | 'ipcore';
export type ThemeVariant = 'dark' | 'light';

// Reuses the existing Playwright browser-test harness pages unmodified --
// they already load the real compiled dist/webview.* / dist/ipcore.* bundles
// and stub acquireVsCodeApi. See src/test/browser/index.html + ipcore.html.
const BROWSER_TEST_DIR = path.resolve(__dirname, '../../src/test/browser');
const THEME_DIR = path.resolve(__dirname, 'theme');

const HARNESS_FILE: Record<HarnessKind, string> = {
  memorymap: 'index.html',
  ipcore: 'ipcore.html',
};

const ROOT_SELECTOR: Record<HarnessKind, string> = {
  memorymap: '#root',
  ipcore: '#ipcore-root',
};

// Kills transitions/animations/caret blink so two captures of the same
// state are pixel-identical.
const STABILIZE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

export interface OpenOptions {
  harness: HarnessKind;
  theme: ThemeVariant;
  yamlText: string;
  fileName?: string;
  /** Parsed memoryMaps import list -- see useIpCoreState.ts's imports.memoryMaps
   *  (an array of {name, ...} objects, matched against busInterfaces[].memoryMapRef).
   *  Without this, an .ip.yml that imports a .mm.yml renders a false
   *  "references unknown memory map" validation error. */
  memoryMapImports?: unknown[];
  viewport: { width: number; height: number };
}

export async function openHarness(page: Page, opts: OpenOptions): Promise<void> {
  const { harness, theme, yamlText, fileName, memoryMapImports, viewport } = opts;

  await page.setViewportSize(viewport);

  const readyPromise = page.waitForEvent('console', {
    predicate: (msg) => msg.text().includes('VSCODE_MESSAGE:') && msg.text().includes('"ready"'),
    timeout: 15000,
  });

  const harnessPath = `file://${path.join(BROWSER_TEST_DIR, HARNESS_FILE[harness])}`;
  await page.goto(harnessPath);
  await page.waitForSelector(ROOT_SELECTOR[harness]);
  await readyPromise;

  // Theme must land before content renders, or the UI paints once with
  // undefined --vscode-* values (invisible text, transparent panels) and
  // never repaints just because the variables later exist.
  await page.addStyleTag({ path: path.join(THEME_DIR, `${theme}.css`) });
  await page.addStyleTag({ content: STABILIZE_CSS });

  if (harness === 'memorymap') {
    // window.__RENDER__ (src/webview/index.tsx) is only wired up once the
    // app has mounted; integration.test.ts found that the very first call
    // can race that mount, so it resends on an interval until the
    // "Loading memory map..." placeholder is gone. Mirrored here so a
    // capture never lands on the loading state.
    await page.evaluate((text) => {
      const send = () =>
        (window as unknown as { __RENDER__: (t: string) => void }).__RENDER__(text);
      const interval = setInterval(() => {
        if (document.body.innerText.includes('Loading memory map...')) {
          send();
        } else {
          clearInterval(interval);
        }
      }, 500);
      send();
      setTimeout(() => clearInterval(interval), 10000);
    }, yamlText);

    await page.waitForSelector('#root main', { timeout: 15000 });
  } else {
    await page.evaluate(
      ({ text, name, memoryMaps }) => {
        window.postMessage(
          {
            type: 'update',
            text,
            fileName: name,
            // IpCoreApp.tsx renders toolbar buttons conditionally on these;
            // without them the toolbar is sparser than what a real user sees.
            // allToolchains must be RegisteredToolchain objects ({id,
            // displayName}) -- TargetVendorPicker calls .split() on
            // displayName, so plain id strings crash the whole React tree.
            hdlLanguage: 'vhdl',
            toolbarTargets: ['vivado', 'quartus'],
            allToolchains: [
              { id: 'vivado', displayName: 'Xilinx Vivado' },
              { id: 'quartus', displayName: 'Intel Quartus' },
            ],
            imports: memoryMaps ? { memoryMaps } : undefined,
          },
          '*'
        );
      },
      { text: yamlText, name: fileName ?? 'source.ip.yml', memoryMaps: memoryMapImports }
    );

    await page.waitForSelector('.ip-canvas-svg', { timeout: 15000 });
  }

  // Let webfonts finish and layout settle after the content swap above.
  await page.waitForTimeout(300);
}
