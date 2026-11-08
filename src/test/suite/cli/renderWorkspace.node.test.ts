/** @jest-environment node */
jest.mock('@xyflow/react', () => {
  throw new Error('React must not load on the render path');
});
jest.mock('react', () => {
  throw new Error('React must not load on the render path');
});

// `ipcraft render --workspace` (issue #268, step 5).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseArgs } from '../../../cli/argv';
import { runCliRender, type CliRenderArgs } from '../../../cli/render';
import { RenderSession } from '../../../cli/renderResources';
import { createWorkspaceIo } from '../../../cli/workspaceIo';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { FONT_FILES } from '../../../shared/render/fontFaces';
import { IP_YML } from '../services/systemDiagram/enrichment/definitionFixtures';

const repoRoot = path.resolve(__dirname, '../../../..');
const fixtures = path.join(repoRoot, 'src/test/fixtures/system-design');
const TOP = path.join(fixtures, 'qsys-subsystem/top.qsys');
const ZYNQ = path.join(fixtures, 'zynq_dma_system.tcl');
const NIOS = path.join(fixtures, 'nios_avalon_system.qsys');

const BD = [
  'create_bd_design "d"',
  'set my_core_0 [ create_bd_cell -type ip -vlnv acme.com:ip:my_core:1.0 my_core_0 ]',
  'set pulse_0 [ create_bd_cell -type module -reference pulse_gen pulse_0 ]',
  'connect_bd_net [get_bd_pins my_core_0/s_axi_aclk] [get_bd_pins pulse_0/clk]',
].join('\n');
const PULSE_VHDL = `entity pulse_gen is
  port (
    clk : in std_logic;
    pulse_out_q : out std_logic_vector(7 downto 0)
  );
end entity;
`;

let tmp: string;
let roots: ReturnType<typeof devResourceRoots>;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-workspace-'));
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

let counter = 0;
function args(input: string, extra: Partial<CliRenderArgs> = {}): CliRenderArgs {
  return {
    inputPath: input,
    out: path.join(tmp, `out${counter++}.svg`),
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
    ...extra,
  };
}

async function render(input: string, extra: Partial<CliRenderArgs> = {}, session?: RenderSession) {
  const result = await runCliRender(args(input, extra), roots, session);
  expect(result.error).toBeUndefined();
  return fs.readFileSync(result.outputPath, 'utf8');
}

function workspace(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(tmp, 'ws-'));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

describe('option parsing', () => {
  const parse = (...rest: string[]) => parseArgs(['render', 'd.tcl', '--out', 'o.svg', ...rest]);

  it('reads --workspace and --no-workspace', () => {
    expect(parse('--workspace', 'ws')).toMatchObject({ kind: 'render', args: { workspace: 'ws' } });
    expect(parse('--no-workspace')).toMatchObject({ kind: 'render', args: { workspace: false } });
    expect(parse()).toMatchObject({ kind: 'render' });
    expect((parse() as { args: CliRenderArgs }).args.workspace).toBeUndefined();
  });

  it('rejects both together, a missing value, and an .ip.yml', () => {
    expect(parse('--workspace', 'ws', '--no-workspace')).toMatchObject({ kind: 'error' });
    expect(parse('--workspace')).toEqual({
      kind: 'error',
      message: 'Missing value for --workspace',
    });
    expect(parseArgs(['render', 'a.ip.yml', '--out', 'o.svg', '--workspace', 'w'])).toEqual({
      kind: 'error',
      message: "Option '--workspace' is only for system designs, not for an .ip.yml",
    });
  });
});

describe('subsystems', () => {
  it('grafts the subsystem next to the design by default, not under --no-workspace', async () => {
    const withWorkspace = await render(TOP, { level: '/sub_0' });
    expect(withWorkspace).toContain('<svg');
    const bare = await runCliRender(args(TOP, { level: '/sub_0', workspace: false }), roots);
    expect(bare.success).toBe(false);
    expect(bare.error).toContain("Unknown level '/sub_0'");
    expect(await render(TOP)).not.toBe(await render(TOP, { workspace: false }));
  });

  it('searches the --workspace folder instead of the design folder', async () => {
    const dir = workspace({
      'lib/sub_system.qsys': fs.readFileSync(
        path.join(fixtures, 'qsys-subsystem/sub_system.qsys'),
        'utf8'
      ),
    });
    const topOnly = workspace({ 'top.qsys': fs.readFileSync(TOP, 'utf8') });
    const top = path.join(topOnly, 'top.qsys');
    const alone = await runCliRender(args(top, { level: '/sub_0' }), roots);
    expect(alone.success).toBe(false);
    expect(await render(top, { level: '/sub_0', workspace: dir })).toContain('<svg');
  });

  it('fails on a workspace folder that does not exist', async () => {
    const result = await runCliRender(args(ZYNQ, { workspace: path.join(tmp, 'nope') }), roots);
    expect(result.error).toContain('Workspace directory not found');
  });
});

describe('definitions', () => {
  it('adds the unconnected pins of a matching .ip.yml by VLNV', async () => {
    const dir = workspace({ 'bd.tcl': BD, 'ip/my_core.ip.yml': IP_YML });
    const design = path.join(dir, 'bd.tcl');
    const enriched = await render(design);
    const bare = await render(design, { workspace: false });
    expect(bare).not.toContain('data_out');
    expect(enriched).toContain('data_out');
    expect(enriched).toContain('irq');
  });

  it('reads the ports of a module reference from an HDL file', async () => {
    const dir = workspace({ 'bd.tcl': BD, 'rtl/pulse_gen.vhd': PULSE_VHDL });
    const design = path.join(dir, 'bd.tcl');
    expect(await render(design)).toContain('pulse_out_q');
    expect(await render(design, { workspace: false })).not.toContain('pulse_out_q');
  });

  it('is the same as no workspace when nothing defines the instances', async () => {
    for (const file of [ZYNQ, NIOS]) {
      expect(await render(file)).toBe(await render(file, { workspace: false }));
    }
  });

  it('is deterministic and shares one scan between renders of a session', async () => {
    const dir = workspace({ 'bd.tcl': BD, 'a/my_core.ip.yml': IP_YML, 'b/my_core.ip.yml': IP_YML });
    const design = path.join(dir, 'bd.tcl');
    const session = new RenderSession();
    const first = await render(design, {}, session);
    fs.rmSync(path.join(dir, 'a'), { recursive: true });
    expect(await render(design, {}, session)).toBe(first);
  });
});

describe('file discovery', () => {
  it('skips dependency and generated folders and files over 1 MiB', async () => {
    const dir = workspace({
      'node_modules/x/a.ip.yml': IP_YML,
      '.git/b.ip.yml': IP_YML,
      'p.gen/c.ip.yml': IP_YML,
      'ok/d.ip.yml': IP_YML,
      'rtl/big.vhd': `entity big is end entity;\n${'-- pad\n'.repeat(200000)}`,
      'rtl/small.v': 'module small(input a);\nendmodule\n',
    });
    const io = createWorkspaceIo(dir);
    expect((await io.listIpFiles()).map((e) => e.displayName)).toEqual(['ok/d.ip.yml']);
    expect((await io.listHdlFiles()).map((e) => e.displayName)).toEqual(['rtl/small.v']);
  });

  it('lists files in sorted order with folder-relative display names', async () => {
    const dir = workspace({ 'z/a.ip.yml': IP_YML, 'b.ip.yml': IP_YML, 'a/c.ip.yml': IP_YML });
    const io = createWorkspaceIo(dir);
    expect((await io.listIpFiles()).map((e) => e.displayName)).toEqual([
      'a/c.ip.yml',
      'b.ip.yml',
      'z/a.ip.yml',
    ]);
  });

  it('follows symbolic links, skips broken ones and stops at loops', async () => {
    const outside = workspace({ 'lib/linked.ip.yml': IP_YML });
    const dir = workspace({ 'real/a.ip.yml': IP_YML });
    try {
      fs.symlinkSync(path.join(outside, 'lib'), path.join(dir, 'linked'), 'dir');
      fs.symlinkSync(path.join(dir, 'real/a.ip.yml'), path.join(dir, 'alias.ip.yml'));
      fs.symlinkSync(path.join(dir, 'missing'), path.join(dir, 'broken.ip.yml'));
      fs.symlinkSync(dir, path.join(dir, 'real/loop'), 'dir');
    } catch {
      return; // symbolic links are not available here
    }
    const io = createWorkspaceIo(dir);
    expect((await io.listIpFiles()).map((e) => e.displayName)).toEqual([
      'alias.ip.yml',
      'linked/linked.ip.yml',
      'real/a.ip.yml',
    ]);
  });

  it('warns about an invalid .ip.yml, strips a byte order mark, and sorts by POSIX path', async () => {
    const dir = workspace({
      'bad.ip.yml': 'vlnv: [',
      'bom/m.ip.yml': `\uFEFF${IP_YML}`,
      'a-b/c.ip.yml': IP_YML,
      'a/c.ip.yml': IP_YML,
    });
    const warnings: string[] = [];
    const io = createWorkspaceIo(dir, (message) => warnings.push(message));
    expect((await io.listIpFiles()).map((e) => e.displayName)).toEqual([
      'a-b/c.ip.yml',
      'a/c.ip.yml',
      'bom/m.ip.yml',
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('bad.ip.yml');
  });
});
