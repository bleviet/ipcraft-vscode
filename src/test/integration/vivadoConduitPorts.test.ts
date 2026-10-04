/**
 * Vivado integration tests for conduit interfaces whose type is a library
 * bus definition (issues #225 and #226).
 *
 * Generates small IP cores with the real IpCoreScaffolder, then asserts on
 * component.xml and the generated top-level HDL. The Vivado runs
 * (ipx::check_integrity through scripts/integration/vivado/validate.tcl) are
 * guarded by guardTier2; every other assertion runs without Vivado.
 *
 * The developer's scanned Vivado catalog (<XDG_CONFIG_HOME>/ipcraft/vivado) is
 * hidden by pointing XDG_CONFIG_HOME at an empty directory, so the library
 * contract below is the only source of the xilinx.com:interface:fifo_write type.
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { IpCoreScaffolder } from '../../generator/IpCoreScaffolder';
import { TemplateLoader } from '../../generator/TemplateLoader';
import { Logger } from '../../utils/Logger';
import { devResourceRoots } from '../../services/ResourceRoots';
import { guardTier2 } from './tier';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const VIVADO_BIN =
  process.env.VIVADO_BIN ?? '/home/balevision/tools/Xilinx/Vivado/2024.2/bin/vivado';
const VALIDATE_TCL = path.join(REPO_ROOT, 'scripts/integration/vivado/validate.tcl');

const FIFO_WRITE_TYPE = 'xilinx.com:interface:fifo_write:1.0';

const FIFO_WRITE_BUSDEF = `XILINX_COM_INTERFACE_FIFO_WRITE_1_0:
  busType:
    vendor: xilinx.com
    library: interface
    name: fifo_write
    version: '1.0'
  source: vivado
  ports:
    - name: WR_DATA
      direction: out
      presence: required
    - name: WR_EN
      width: 1
      direction: out
      presence: required
    - name: FULL
      width: 1
      direction: in
      presence: optional
    - name: ALMOST_FULL
      width: 1
      direction: in
      presence: optional
`;

interface ConduitPort {
  name: string;
  direction: 'in' | 'out';
  width: number;
}

interface CaseSpec {
  name: string;
  type: string;
  /** Conformance rejects mode 'conduit' on a resolved fifo_write (BUS_INTERFACE_MODE), so master is how #225 is reached. */
  mode: 'conduit' | 'master';
  conduitPorts?: ConduitPort[];
  portNameOverrides?: Record<string, string>;
  useBusLibrary?: boolean;
}

interface Generated {
  success: boolean;
  issues: readonly { code: string; interfaceName?: string }[];
  error?: string;
  xilinxDir: string;
  componentXml: string;
  topHdl: string;
}

let workDir = '';
let previousXdg: string | undefined;

function ipYaml(spec: CaseSpec): string {
  const ports = (spec.conduitPorts ?? [])
    .map(
      (p) =>
        `      - name: ${p.name}\n        direction: ${p.direction}\n        presence: required\n        width: ${p.width}\n`
    )
    .join('');
  const overrides = spec.portNameOverrides
    ? '    portNameOverrides:\n' +
      Object.entries(spec.portNameOverrides)
        .map(([logical, physical]) => `      ${logical}: ${physical}\n`)
        .join('')
    : '';
  return (
    `vlnv:\n  vendor: ipcraft\n  library: tests\n  name: ${spec.name}\n  version: 1.0.0\n` +
    `apiVersion: '1.1'\n` +
    `clocks:\n  - name: clk\n    logicalName: CLK\n    direction: in\n    frequency: 100MHz\n    associatedReset: reset_n\n` +
    `resets:\n  - name: reset_n\n    logicalName: RESET_N\n    direction: in\n    polarity: activeLow\n    associatedClock: clk\n` +
    `busInterfaces:\n  - name: fifo_write\n    type: ${spec.type}\n    mode: ${spec.mode}\n` +
    (spec.mode === 'conduit' ? '' : `    physicalPrefix: ''\n`) +
    (spec.conduitPorts ? `    conduitPorts:\n${ports}` : '') +
    overrides +
    (spec.useBusLibrary ? 'useBusLibrary: ./bus_library\n' : '')
  );
}

async function generate(spec: CaseSpec): Promise<Generated> {
  const caseDir = path.join(workDir, spec.name);
  fs.mkdirSync(caseDir, { recursive: true });
  if (spec.useBusLibrary) {
    const libDir = path.join(caseDir, 'bus_library');
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(
      path.join(libDir, 'xilinx_com_interface_fifo_write_1_0.yml'),
      FIFO_WRITE_BUSDEF
    );
  }
  const yamlPath = path.join(caseDir, `${spec.name}.ip.yml`);
  fs.writeFileSync(yamlPath, ipYaml(spec));
  const outputDir = path.join(caseDir, 'out');

  const silent = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as Logger;
  const loader = new TemplateLoader(silent, path.join(REPO_ROOT, 'src/generator/templates'));
  const scaffolder = new IpCoreScaffolder(silent, loader, devResourceRoots(REPO_ROOT));
  const result = await scaffolder.generateAll(yamlPath, outputDir, {
    targets: ['vivado'],
    hdlLanguage: 'vhdl',
  });

  const xilinxDir = path.join(outputDir, 'xilinx');
  const componentPath = path.join(xilinxDir, 'component.xml');
  const contents = result.generatedContents ?? {};
  const topKey = Object.keys(contents).find(
    (f) =>
      f.startsWith('rtl/') &&
      f.endsWith('.vhd') &&
      !f.endsWith('_pkg.vhd') &&
      !f.endsWith('_core.vhd')
  );
  return {
    success: result.success,
    issues: result.issues ?? [],
    error: result.error,
    xilinxDir,
    componentXml: fs.existsSync(componentPath) ? fs.readFileSync(componentPath, 'utf8') : '',
    topHdl: topKey ? contents[topKey] : '',
  };
}

/** The ipx::check_integrity ERROR / CRITICAL WARNING IDs between the validator's markers. */
function validate(xilinxDir: string): { status: number | null; ids: string[]; output: string } {
  const logPath = path.join(xilinxDir, 'validate.out');
  const fd = fs.openSync(logPath, 'w');
  try {
    const result = spawnSync(
      VIVADO_BIN,
      ['-mode', 'batch', '-nojournal', '-nolog', '-source', VALIDATE_TCL, '-tclargs', xilinxDir],
      { stdio: ['ignore', fd, fd], timeout: 120_000 }
    );
    const output = fs.readFileSync(logPath, 'utf8');
    const lines = output.split('\n');
    const begin = lines.indexOf('=== component validation begin ===');
    const end = lines.indexOf('=== component validation end ===');
    const ids =
      begin < 0 || end < begin
        ? []
        : lines
            .slice(begin + 1, end)
            .map((line) => /^(?:ERROR|CRITICAL WARNING): \[([^\]]+)\]/.exec(line)?.[1])
            .filter((id): id is string => id !== undefined);
    return { status: result.status, ids: [...new Set(ids)].sort(), output };
  } finally {
    fs.closeSync(fd);
  }
}

function expectVivadoPasses(xilinxDir: string): void {
  if (
    guardTier2(
      'vivado',
      () => fs.existsSync(VIVADO_BIN),
      `not found at ${VIVADO_BIN} (set VIVADO_BIN or REQUIRE_VIVADO=1)`
    )
  ) {
    return;
  }
  const run = validate(xilinxDir);
  if (run.status !== 0 || run.ids.length > 0) {
    throw new Error(`Vivado check_integrity failed [${run.ids.join(', ')}]\n${run.output}`);
  }
}

function busInterfaceBlock(xml: string, name: string): string {
  const idx = xml.indexOf(`<spirit:name>${name}</spirit:name>`);
  return idx < 0 ? '' : xml.slice(idx, xml.indexOf('</spirit:busInterface>', idx));
}

function modelPortNames(xml: string): string[] {
  const start = xml.indexOf('<spirit:model>');
  const model = xml.slice(start, xml.indexOf('</spirit:model>', start));
  return [...model.matchAll(/<spirit:port>\s*<spirit:name>([^<]+)<\/spirit:name>/g)].map(
    (m) => m[1]
  );
}

function expectEntityPorts(hdl: string, names: string[]): void {
  for (const name of names) {
    expect(hdl).toMatch(new RegExp(`\\b${name}\\s*:\\s*(in|out)\\b`, 'i'));
  }
}

function logicalMapsTo(block: string, logical: string, physical: string): boolean {
  return new RegExp(
    `<spirit:logicalPort>\\s*<spirit:name>${logical}</spirit:name>\\s*</spirit:logicalPort>\\s*<spirit:physicalPort>\\s*<spirit:name>${physical}</spirit:name>`
  ).test(block);
}

beforeAll(() => {
  workDir = path.join(REPO_ROOT, '.test-fixtures', `vivado-conduit-${process.pid}`);
  fs.rmSync(workDir, { recursive: true, force: true });
  const emptyConfig = path.join(workDir, 'empty-config');
  fs.mkdirSync(emptyConfig, { recursive: true });
  previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = emptyConfig;
});

afterAll(() => {
  if (previousXdg === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = previousXdg;
  }
});

describe('fifo_write conduit with a library bus definition', () => {
  it('225-undeclared: authored names the type does not declare stay plain model ports', async () => {
    const names = ['fifo_wr_en', 'fifo_wr_data', 'fifo_almost_full'];
    const out = await generate({
      name: 'undeclared',
      mode: 'master',
      type: FIFO_WRITE_TYPE,
      useBusLibrary: true,
      conduitPorts: [
        { name: 'fifo_wr_en', direction: 'out', width: 1 },
        { name: 'fifo_wr_data', direction: 'out', width: 8 },
        { name: 'fifo_almost_full', direction: 'in', width: 1 },
      ],
    });
    expect([out.error, JSON.stringify(out.issues)]).toEqual([undefined, '[]']);
    expect(out.success).toBe(true);
    expect(out.componentXml).not.toContain('<spirit:name>fifo_write</spirit:name>');
    expect(busInterfaceBlock(out.componentXml, 'fifo_write')).toBe('');
    expect(modelPortNames(out.componentXml)).toEqual(expect.arrayContaining(names));
    expectEntityPorts(out.topHdl, names);
    expectVivadoPasses(out.xilinxDir);
  }, 180_000);

  it('225-declared: names matching declared logical ports map, the rest stay plain', async () => {
    const out = await generate({
      name: 'declared',
      mode: 'master',
      type: FIFO_WRITE_TYPE,
      useBusLibrary: true,
      conduitPorts: [
        { name: 'WR_EN', direction: 'out', width: 1 },
        { name: 'WR_DATA', direction: 'out', width: 8 },
        { name: 'fifo_almost_full', direction: 'in', width: 1 },
      ],
      portNameOverrides: { WR_EN: 'fifo_wr_en', WR_DATA: 'fifo_wr_data' },
    });
    expect([out.error, JSON.stringify(out.issues)]).toEqual([undefined, '[]']);
    expect(out.success).toBe(true);
    const block = busInterfaceBlock(out.componentXml, 'fifo_write');
    expect(block).toContain('spirit:vendor="xilinx.com"');
    expect(logicalMapsTo(block, 'WR_EN', 'fifo_wr_en')).toBe(true);
    expect(logicalMapsTo(block, 'WR_DATA', 'fifo_wr_data')).toBe(true);
    expect(block).not.toContain('fifo_almost_full');
    const names = ['fifo_wr_en', 'fifo_wr_data', 'fifo_almost_full'];
    expect(modelPortNames(out.componentXml)).toEqual(expect.arrayContaining(names));
    expectEntityPorts(out.topHdl, names);
    expectVivadoPasses(out.xilinxDir);
  }, 180_000);

  it('226-blocked: an unresolved conduit with no ports and no library blocks generation', async () => {
    const out = await generate({ name: 'blocked', type: FIFO_WRITE_TYPE, mode: 'conduit' });
    expect(out.success).toBe(false);
    expect(out.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'BUS_TYPE_UNRESOLVED', interfaceName: 'fifo_write' }),
      ])
    );
  }, 180_000);

  it('placeholder: the generic conduit type with no ports generates and passes Vivado', async () => {
    const out = await generate({
      name: 'placeholder',
      type: 'ipcraft:busif:conduit:1.0',
      mode: 'conduit',
    });
    expect([out.error, JSON.stringify(out.issues)]).toEqual([undefined, '[]']);
    expect(out.success).toBe(true);
    expectVivadoPasses(out.xilinxDir);
  }, 180_000);
});
