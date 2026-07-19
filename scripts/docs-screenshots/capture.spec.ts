// Generic runner over the shots.ts manifest -- captures every shot in both
// themes into docs/images/. Adding a new docs image is a new entry in
// shots.ts, not a new spec file. See docs/concepts/docs-screenshots.md.
import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { openHarness, type ThemeVariant } from './harness';
import { shots, readShotSource, readShotMemoryMapImports } from './shots';

const OUTPUT_DIR = path.resolve(__dirname, '../../docs/images');
const THEMES: ThemeVariant[] = ['dark', 'light'];

test.beforeAll(() => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
});

for (const shot of shots) {
  for (const theme of THEMES) {
    test(`${shot.id} (${theme})`, async ({ page }) => {
      await openHarness(page, {
        harness: shot.harness,
        theme,
        yamlText: readShotSource(shot),
        fileName: shot.fileName,
        memoryMapImports: readShotMemoryMapImports(shot),
        viewport: shot.viewport ?? { width: 1400, height: 900 },
      });

      if (shot.setup) {
        await shot.setup(page);
        await page.waitForTimeout(300);
      }

      const outputPath = path.join(OUTPUT_DIR, `${shot.id}-${theme}.png`);
      if (shot.clip) {
        await page.locator(shot.clip).screenshot({ path: outputPath });
      } else {
        await page.screenshot({ path: outputPath });
      }
    });
  }
}
