/** @jest-environment node */
// Own file: the wasm module initializes once per process, so a missing module is only seen
// before any other test has rendered a raster image.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCliRender } from '../../../cli/render';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { FONT_FILES } from '../../../shared/render/fontFaces';

const repoRoot = path.resolve(__dirname, '../../../..');

it('names a missing rasterizer module', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-nowasm-'));
  try {
    const fontsDir = path.join(tmp, 'fonts');
    fs.mkdirSync(fontsDir);
    for (const file of Object.values(FONT_FILES)) {
      const family = file.startsWith('ibm-plex-mono') ? 'ibm-plex-mono' : 'ibm-plex-sans';
      fs.copyFileSync(
        path.join(repoRoot, 'node_modules/@fontsource', family, 'files', file),
        path.join(fontsDir, file)
      );
    }
    const result = await runCliRender(
      {
        inputPath: path.join(repoRoot, 'src/test/fixtures/system-design/zynq_dma_system.tcl'),
        out: path.join(tmp, 'x.png'),
        level: '/',
        expand: [],
        theme: 'light',
        grid: true,
        legend: true,
        background: 'editor',
        scale: 1,
        quality: 90,
      },
      { ...devResourceRoots(repoRoot), fontsDir, resvgWasmPath: path.join(tmp, 'absent.wasm') }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Rasterizer module not found:');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
