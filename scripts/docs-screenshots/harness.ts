import type { Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import * as YAML from 'yaml';

export type HarnessKind = 'memorymap' | 'ipcore' | 'dataInspector';
export type ThemeVariant = 'dark' | 'light';

// Reuses the existing Playwright browser-test harness pages unmodified --
// they already load the real compiled dist/webview.* / dist/ipcore.* bundles
// and stub acquireVsCodeApi. See src/test/browser/index.html + ipcore.html.
const BROWSER_TEST_DIR = path.resolve(__dirname, '../../src/test/browser');
const THEME_DIR = path.resolve(__dirname, 'theme');

const HARNESS_FILE: Record<HarnessKind, string> = {
  memorymap: 'index.html',
  ipcore: 'ipcore.html',
  dataInspector: 'data-inspector.html',
};

const ROOT_SELECTOR: Record<HarnessKind, string> = {
  memorymap: '#root',
  ipcore: '#ipcore-root',
  dataInspector: '#data-inspector-root',
};

// The active dark-theme stylesheet -- Dracula rather than VS Code's bundled
// Dark Modern, per the maintainer's own installed theme. dark.css (Dark
// Modern) is kept in theme/ as a reference/fallback that needs no extension
// dependency; swap this back to 'dark' to use it instead.
const THEME_FILE: Record<ThemeVariant, string> = {
  dark: 'dracula',
  light: 'light',
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

  const harnessFsPath = path.join(BROWSER_TEST_DIR, HARNESS_FILE[harness]);
  const harnessPath = `file://${harnessFsPath}`;

  // The @vscode/webview-ui-toolkit custom elements (<vscode-text-field> etc.)
  // read --vscode-* custom properties into their own internal design tokens
  // (e.g. --input-background) ONCE, when each component first connects --
  // not as a live var() binding. By the time a post-navigation
  // page.addStyleTag() call could run, the app has already mounted and every
  // token has snapshotted the (still unset) variable, permanently falling
  // back to the toolkit's own hardcoded dark default (--input-background:
  // #3c3c3c) regardless of theme. Injecting via page.addInitScript() doesn't
  // fix this either -- content appended to document.documentElement before
  // navigation gets discarded once the real HTML parser starts writing
  // <head>/<body> for the navigated document. Routing the request and
  // inlining the theme <style> directly into the served HTML is the only
  // ordering that lands before the bundle's own <script> tag runs.
  const themeCss = fs.readFileSync(path.join(THEME_DIR, `${THEME_FILE[theme]}.css`), 'utf-8');
  await page.route(harnessPath, async (route) => {
    const html = fs.readFileSync(harnessFsPath, 'utf-8');
    const injected = html.replace(
      '</head>',
      `<style>${themeCss}</style><style>${STABILIZE_CSS}</style></head>`
    );
    await route.fulfill({ body: injected, contentType: 'text/html' });
  });

  await page.goto(harnessPath);
  await page.waitForSelector(ROOT_SELECTOR[harness]);
  await readyPromise;

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
  } else if (harness === 'ipcore') {
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
  } else {
    const recipe = YAML.parse(yamlText) as unknown;
    await page.evaluate((value) => {
      (window as unknown as { renderRecipe: (recipe: unknown) => void }).renderRecipe(value);
    }, recipe);
    await page.waitForSelector('.di-shell', { timeout: 15000 });
  }

  // Let webfonts finish and layout settle after the content swap above.
  await page.waitForTimeout(300);
}
