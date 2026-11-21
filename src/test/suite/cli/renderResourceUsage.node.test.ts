/** @jest-environment node */
// `ipcraft render --resources` on the spike: the strips of the usage on the image.
jest.mock('@xyflow/react', () => {
  throw new Error('React must not load on the render path');
});
jest.mock('react', () => {
  throw new Error('React must not load on the render path');
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCliRender, type CliRenderArgs } from '../../../cli/render';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { FONT_FILES } from '../../../shared/render/fontFaces';

const repoRoot = path.resolve(__dirname, '../../../..');
const VIVADO = path.join(repoRoot, 'src/test/fixtures/reports/vivado/spike');
const HIER = path.join(VIVADO, 'routed_hier.rpt');
const COUNTS = '154 LUT · 168 FF · 0 BRAM · 0 DSP';
const SHARE = '18.3 % design';

let tmp: string;
let roots: ReturnType<typeof devResourceRoots>;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-render-resources-'));
  const fontsDir = path.join(tmp, 'fonts');
  fs.mkdirSync(fontsDir);
  for (const file of Object.values(FONT_FILES)) {
    const family = file.startsWith('ibm-plex-mono') ? 'ibm-plex-mono' : 'ibm-plex-sans';
    fs.copyFileSync(
      path.join(repoRoot, 'node_modules/@fontsource', family, 'files', file),
      path.join(fontsDir, file)
    );
  }
  roots = { ...devResourceRoots(repoRoot), fontsDir };
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function args(name: string, extra: Partial<CliRenderArgs> = {}): CliRenderArgs {
  return {
    inputPath: path.join(VIVADO, 'sys.bd'),
    out: path.join(tmp, name),
    level: '/',
    expand: [],
    select: [],
    highlight: [],
    clocks: false,
    theme: 'light',
    grid: true,
    legend: true,
    background: 'editor',
    scale: 2,
    quality: 90,
    workspace: false,
    ...extra,
  };
}

async function render(name: string, extra: Partial<CliRenderArgs>) {
  const result = await runCliRender(args(name, extra), roots);
  return { result, svg: result.success ? fs.readFileSync(result.outputPath, 'utf8') : '' };
}

describe('runCliRender --resources', () => {
  let stderr: jest.SpyInstance;
  beforeEach(() => {
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => stderr.mockRestore());

  it('draws the strip of figures above the blocks; without --resources the image has none', async () => {
    const plain = await render('plain.svg', {});
    const withUsage = await render('usage.svg', { resources: { reports: [HIER] } });
    expect(withUsage.result.error).toBeUndefined();
    expect(plain.svg).not.toContain('LUT');
    expect(withUsage.svg).toContain(`>${COUNTS}</text>`);
    expect(withUsage.svg).toContain(`>${SHARE}</text>`);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('adds the share of the device to the strip when a capacity file is given', async () => {
    const { svg } = await render('capacity.svg', {
      resources: { reports: [HIER], capacity: path.join(VIVADO, 'routed_flat.rpt') },
    });
    expect(svg).toContain(`>${COUNTS}</text>`);
    expect(svg).toContain(`>${SHARE} · 0.2 % device</text>`);
  });

  it('draws the strips of the per-IP reports', async () => {
    const reports = fs
      .readdirSync(path.join(VIVADO, 'ooc'))
      .map((file) => path.join(VIVADO, 'ooc', file));
    const { result, svg } = await render('ooc.svg', { resources: { reports } });
    expect(result.error).toBeUndefined();
    expect(svg).toContain('188 LUT');
  });

  it('fails for an unusable report', async () => {
    const { result } = await render('refused.svg', {
      resources: { reports: [path.join(VIVADO, 'sys_wrapper_timing_summary_routed.rpt')] },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not a utilization report');
  });

  it('warns on standard error when the design is not in the report, and still draws', async () => {
    const { result } = await render('other.svg', {
      inputPath: path.resolve(repoRoot, 'src/test/fixtures/system-design/zynq_dma_system.tcl'),
      resources: { reports: [HIER] },
    });
    expect(result.success).toBe(true);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('is not in the report'));
  });
});
