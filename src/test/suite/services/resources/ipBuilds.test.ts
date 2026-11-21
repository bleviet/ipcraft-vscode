import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readBdJson } from '../../../../parser/system/BdJsonReader';
import { readQsys } from '../../../../parser/system/QsysReader';
import type { ResourceReport } from '../../../../domain/resourceUsage';
import type { SystemGraph } from '../../../../domain/systemGraph';
import { discoverIpBuilds } from '../../../../services/resources/ipBuildCandidates';
import { loadCandidate, mapLoaded } from '../../../../services/resources/loadResourceSource';
import { mapOocReports } from '../../../../services/resources/mapReportToGraph';
import type { ReportCandidate } from '../../../../services/resources/reportCandidates';
import { defaultSource, projectEntries } from '../../../../services/resources/resourceSources';
import { ipCoreBuildName } from '../../../../services/toolchains/buildPaths';
import { quartusFixture, vivadoFixture } from './fixtures';

const bd = readBdJson(vivadoFixture('sys.bd'), 'sys.bd');
const qsys = readQsys(quartusFixture('sys.qsys'), 'sys.qsys');

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-builds-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(text: string, ...to: string[]): string {
  const target = path.join(root, ...to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
  return target;
}

const ipYml = (name: string): string => `vlnv:\n  name: ${name}\n  vendor: acme\n`;

/** `graph` where each listed instance is defined by the `.ip.yml` of its IP directory. */
function withDefinitions(graph: SystemGraph, defined: Record<string, string>): SystemGraph {
  const instances = { ...graph.instances };
  for (const [instance, ipFile] of Object.entries(defined)) {
    instances[instance] = {
      ...instances[instance],
      definition: {
        kind: 'ip.yml',
        file: ipFile,
        uri: `file://${ipFile}`,
        displayName: path.basename(ipFile),
      },
    };
  }
  return { ...graph, instances };
}

const oocReport = (ip: string): string => vivadoFixture(`ooc/${ip}_utilization_synth.rpt`);

/** Two IP directories with Vivado builds, one shared by two instances, and a block without any. */
function vivadoWorkspace(): SystemGraph {
  const gpio = write(ipYml('gpio'), 'gpio', 'gpio.ip.yml');
  write(oocReport('sys_axi_gpio_0_0'), 'gpio', 'xilinx', 'build', 'ooc', 'utilization.rpt');
  const bram = write(ipYml('bram'), 'bram', 'bram.ip.yml');
  // No out-of-context report: the full implementation one is the fallback.
  write(oocReport('sys_bram_0_0'), 'bram', 'xilinx', 'build', 'xpr', 'utilization.rpt');
  const smart = write(ipYml('smart'), 'smart', 'smart.ip.yml');
  return withDefinitions(bd, {
    '/axi_gpio_0': gpio,
    '/hier_0/axi_gpio_1': gpio,
    '/hier_0/bram_0': bram,
    '/smartconnect_0': smart,
  });
}

/** Two IP cores with Quartus builds; only the first has a `.fit.summary`. */
function quartusWorkspace(): SystemGraph {
  const first = write(ipYml('Spike'), 'one', 'one.ip.yml');
  const out = ['altera', 'build', 'output_files'];
  write(quartusFixture('spike.fit.rpt'), 'one', ...out, 'spike.fit.rpt');
  write(quartusFixture('spike.fit.summary'), 'one', ...out, 'spike.fit.summary');
  const second = write(ipYml('spike_b'), 'two', 'two.ip.yml');
  write(quartusFixture('spike.fit.rpt'), 'two', ...out, 'spike_b.fit.rpt');
  return withDefinitions(qsys, { '/pio_0': first, '/pio_1': second });
}

const valueOf = (report: ResourceReport, path: string, label: string): number =>
  report.instances[path].total[report.metrics.findIndex((m) => m.label === label)];

describe('discoverIpBuilds', () => {
  it('lists one candidate counting the blocks with a build report', async () => {
    const [candidate] = await discoverIpBuilds(vivadoWorkspace());
    expect(candidate).toMatchObject({
      id: 'ipBuilds',
      group: 'ipBuilds',
      vendor: 'vivado',
      stage: 'ooc',
      label: 'IPCraft builds (3 of 4 blocks, 1 post-route)',
      usable: true,
    });
    expect(candidate.builds?.map((b) => [b.mode, b.instances])).toEqual([
      ['ooc', ['/axi_gpio_0', '/hier_0/axi_gpio_1']],
      ['xpr', ['/hier_0/bram_0']],
    ]);
    expect(candidate.files.map((f) => path.relative(root, f))).toEqual([
      path.join('gpio', 'xilinx', 'build', 'ooc', 'utilization.rpt'),
      path.join('bram', 'xilinx', 'build', 'xpr', 'utilization.rpt'),
    ]);
  });

  it('prefers the out-of-context report to the implementation one', async () => {
    const gpio = write(ipYml('gpio'), 'gpio', 'gpio.ip.yml');
    write(oocReport('sys_axi_gpio_0_0'), 'gpio', 'xilinx', 'build', 'ooc', 'utilization.rpt');
    write(oocReport('sys_bram_0_0'), 'gpio', 'xilinx', 'build', 'xpr', 'utilization.rpt');
    const [candidate] = await discoverIpBuilds(withDefinitions(bd, { '/axi_gpio_0': gpio }));
    expect(candidate.builds?.[0].file).toContain(path.join('build', 'ooc'));
  });

  it('is absent when no block has a build report', async () => {
    const gpio = write(ipYml('gpio'), 'gpio', 'gpio.ip.yml');
    write('not a report', 'gpio', 'xilinx', 'build', 'ooc', 'utilization.rpt');
    expect(await discoverIpBuilds(withDefinitions(bd, { '/axi_gpio_0': gpio }))).toEqual([]);
    expect(await discoverIpBuilds(bd)).toEqual([]);
  });

  it('ignores a block defined by an HDL file', async () => {
    write(oocReport('sys_axi_gpio_0_0'), 'gpio', 'xilinx', 'build', 'ooc', 'utilization.rpt');
    const graph = withDefinitions(bd, { '/axi_gpio_0': path.join(root, 'gpio', 'gpio.ip.yml') });
    graph.instances['/axi_gpio_0'].definition!.kind = 'hdl';
    expect(await discoverIpBuilds(graph)).toEqual([]);
  });

  it('reads the Quartus fit report named after the IP core, with its summary', async () => {
    const [candidate] = await discoverIpBuilds(quartusWorkspace());
    expect(candidate).toMatchObject({
      vendor: 'quartus',
      stage: 'ooc',
      label: 'IPCraft builds (2 of 2 blocks)',
    });
    expect(
      candidate.builds?.map((b) => [path.basename(b.file), b.capacityFile !== undefined])
    ).toEqual([
      ['spike.fit.rpt', true],
      ['spike_b.fit.rpt', false],
    ]);
  });
});

describe('IPCraft builds mapped onto the design', () => {
  it('maps each Vivado report to its instances without an xci name', async () => {
    const graph = vivadoWorkspace();
    const [candidate] = await discoverIpBuilds(graph);
    const report = mapLoaded(await loadCandidate(candidate, 'IPCraft builds'), graph);
    expect(report.stage).toBe('ooc');
    expect(report.source.fileName).toBe('IPCraft builds');
    expect(valueOf(report, '/axi_gpio_0', 'LUTs')).toBe(131);
    expect(valueOf(report, '/hier_0/axi_gpio_1', 'LUTs')).toBe(131);
    expect(valueOf(report, '/hier_0/bram_0', 'BRAM')).toBe(2);
    expect(report.notInReport).toEqual(
      expect.arrayContaining(['/smartconnect_0', '/axi_bram_ctrl_0'])
    );
    expect(report.instances['/hier_0'].summed).toBe(true);
    expect(report.design.summed).toBe(true);
  });

  it('uses the top row of the Quartus fit entity table, with the capacity of the summary', async () => {
    const graph = quartusWorkspace();
    const [candidate] = await discoverIpBuilds(graph);
    const report = mapLoaded(await loadCandidate(candidate, 'IPCraft builds'), graph);
    expect(report.vendor).toBe('quartus');
    expect(report.stage).toBe('ooc');
    expect(valueOf(report, '/pio_0', 'ALMs')).toBeCloseTo(120.5);
    expect(valueOf(report, '/pio_1', 'ALMs')).toBeCloseTo(120.5);
    expect(report.design.total[report.metrics.findIndex((m) => m.label === 'ALMs')]).toBeCloseTo(
      241
    );
    expect(report.metrics.find((m) => m.label === 'ALMs')?.capacity).toBe(32070);
    expect(report.notInReport).toContain('/ram_0');
  });
});

describe('mapOocReports with an instance', () => {
  it('maps by instance path and still maps the others by xci name', () => {
    const report = mapOocReports(
      [
        { instance: '/hier_0/bram_0', design: '', text: oocReport('sys_axi_gpio_0_0') },
        { design: 'sys_axi_gpio_0_0', text: oocReport('sys_axi_gpio_0_0') },
      ],
      bd,
      { fileName: 'x' }
    );
    expect(valueOf(report, '/hier_0/bram_0', 'LUTs')).toBe(131);
    expect(valueOf(report, '/axi_gpio_0', 'LUTs')).toBe(131);
  });

  it('ignores an instance that is not in the design', () => {
    const report = mapOocReports(
      [{ instance: '/nowhere', design: '', text: oocReport('sys_bram_0_0') }],
      bd,
      { fileName: 'x' }
    );
    expect(report.instances['/nowhere']).toBeUndefined();
  });
});

describe('default source', () => {
  const builds = async (): Promise<ReportCandidate> =>
    (await discoverIpBuilds(vivadoWorkspace()))[0];
  const usableProject = (
    builtFrom: ReportCandidate,
    stage: 'synth' | 'routed'
  ): ReportCandidate => ({
    ...builtFrom,
    id: `report-${stage}`,
    group: 'hierarchy',
    stage,
    builds: undefined,
  });
  const rel = (file: string): string => file;

  it('is the IPCraft builds only when nothing else is usable', async () => {
    const ipBuilds = await builds();
    const alone = projectEntries([ipBuilds], rel);
    expect(defaultSource(alone)).toBe('project:ipBuilds');
    const refused = projectEntries(
      [{ ...usableProject(ipBuilds, 'synth'), usable: false, reason: 'no' }, ipBuilds],
      rel
    );
    expect(defaultSource(refused)).toBe('project:ipBuilds');
  });

  it('is never the IPCraft builds when a project source is usable', async () => {
    const ipBuilds = await builds();
    const oocGroup: ReportCandidate = {
      ...usableProject(ipBuilds, 'synth'),
      group: 'ooc',
      stage: 'ooc',
    };
    for (const other of [usableProject(ipBuilds, 'synth'), oocGroup]) {
      expect(defaultSource(projectEntries([other, ipBuilds], rel))).toBe(`project:${other.id}`);
      expect(defaultSource(projectEntries([ipBuilds, other], rel))).toBe(`project:${other.id}`);
    }
  });

  it('shows IPCraft builds as the file name of its entry', async () => {
    const [entry] = projectEntries([await builds()], rel);
    expect(entry.option.fileName).toBe('IPCraft builds');
    expect(entry.option.stage).toBe('ooc');
  });
});

describe('IPCraft builds: device', () => {
  const OTHER = 'xc7z020clg400-1';
  const withDevice = (text: string, device: string): string =>
    text.replace(/^(\| Device\s*:\s*).*$/m, `$1${device}`);

  function twoVivado(secondDevice: string): SystemGraph {
    const a = write(ipYml('a'), 'a', 'a.ip.yml');
    write(oocReport('sys_axi_gpio_0_0'), 'a', 'xilinx', 'build', 'ooc', 'utilization.rpt');
    const b = write(ipYml('b'), 'b', 'b.ip.yml');
    write(
      withDevice(oocReport('sys_bram_0_0'), secondDevice),
      'b',
      'xilinx',
      'build',
      'ooc',
      'utilization.rpt'
    );
    return withDefinitions(bd, { '/axi_gpio_0': a, '/hier_0/bram_0': b });
  }

  const reportOf = async (graph: SystemGraph): Promise<ResourceReport> => {
    const [candidate] = await discoverIpBuilds(graph);
    return mapLoaded(await loadCandidate(candidate, 'IPCraft builds'), graph);
  };

  it('keeps the device and capacity when every Vivado build is on the same device', async () => {
    const report = await reportOf(twoVivado('xc7a100tfgg676-1'));
    expect(report.source.device).toBe('xc7a100tfgg676-1');
    expect(report.metrics.find((m) => m.label === 'LUTs')?.capacity).toBe(63400);
  });

  it('shows neither device nor capacity when the Vivado builds are on different devices', async () => {
    const report = await reportOf(twoVivado(OTHER));
    expect(report.source.device).toBeUndefined();
    expect(report.metrics.every((m) => m.capacity === undefined)).toBe(true);
  });

  it('takes the Quartus capacity and device from the first build that has a summary', async () => {
    const out = ['altera', 'build', 'output_files'];
    const first = write(ipYml('one'), 'one', 'one.ip.yml');
    write(quartusFixture('spike.fit.rpt'), 'one', ...out, 'one.fit.rpt');
    const second = write(ipYml('two'), 'two', 'two.ip.yml');
    write(quartusFixture('spike.fit.rpt'), 'two', ...out, 'two.fit.rpt');
    write(quartusFixture('spike.fit.summary'), 'two', ...out, 'two.fit.summary');
    const report = await reportOf(withDefinitions(qsys, { '/pio_0': first, '/pio_1': second }));
    expect(report.metrics.find((m) => m.label === 'ALMs')?.capacity).toBe(32070);
    expect(report.source.device).toBe('5CSEMA5F31C6');
  });

  it('shows neither device nor capacity when the Quartus builds are on different devices', async () => {
    const out = ['altera', 'build', 'output_files'];
    const first = write(ipYml('one'), 'one', 'one.ip.yml');
    write(quartusFixture('spike.fit.rpt'), 'one', ...out, 'one.fit.rpt');
    write(quartusFixture('spike.fit.summary'), 'one', ...out, 'one.fit.summary');
    const second = write(ipYml('two'), 'two', 'two.ip.yml');
    write(quartusFixture('spike.fit.rpt'), 'two', ...out, 'two.fit.rpt');
    write(
      quartusFixture('spike.fit.summary').replace('5CSEMA5F31C6', '5CGXFC7C7F23C8'),
      'two',
      ...out,
      'two.fit.summary'
    );
    const report = await reportOf(withDefinitions(qsys, { '/pio_0': first, '/pio_1': second }));
    expect(report.metrics.every((m) => m.capacity === undefined)).toBe(true);
    expect(report.source.device).toBeUndefined();
  });
});

describe('IPCraft builds: label', () => {
  it('says block for a single block', async () => {
    const a = write(ipYml('a'), 'a', 'a.ip.yml');
    write(oocReport('sys_axi_gpio_0_0'), 'a', 'xilinx', 'build', 'ooc', 'utilization.rpt');
    const [candidate] = await discoverIpBuilds(withDefinitions(bd, { '/axi_gpio_0': a }));
    expect(candidate.label).toBe('IPCraft builds (1 of 1 block)');
  });

  it('counts the blocks that fell back to the implementation report', async () => {
    const [candidate] = await discoverIpBuilds(vivadoWorkspace());
    expect(candidate.label).toBe('IPCraft builds (3 of 4 blocks, 1 post-route)');
  });
});

describe('IPCraft builds: unusable IP cores and other vendors', () => {
  const out = ['altera', 'build', 'output_files'];

  it.each([
    ['broken YAML', 'vlnv: [unclosed\n  name: x\n'],
    ['no vlnv.name', 'vlnv:\n  vendor: acme\n'],
  ])('skips a Quartus block whose .ip.yml has %s and still finds the others', async (_n, text) => {
    const bad = write(text, 'bad', 'bad.ip.yml');
    write(quartusFixture('spike.fit.rpt'), 'bad', ...out, 'bad.fit.rpt');
    const good = write(ipYml('good'), 'good', 'good.ip.yml');
    write(quartusFixture('spike.fit.rpt'), 'good', ...out, 'good.fit.rpt');
    const [candidate] = await discoverIpBuilds(
      withDefinitions(qsys, { '/pio_0': bad, '/pio_1': good })
    );
    expect(candidate.label).toBe('IPCraft builds (1 of 2 blocks)');
    expect(candidate.builds?.map((b) => b.instances)).toEqual([['/pio_1']]);
  });

  it('ignores the Quartus reports for a Vivado design', async () => {
    const a = write(ipYml('spike'), 'a', 'a.ip.yml');
    write(quartusFixture('spike.fit.rpt'), 'a', ...out, 'spike.fit.rpt');
    expect(await discoverIpBuilds(withDefinitions(bd, { '/axi_gpio_0': a }))).toEqual([]);
  });

  it('ignores the Vivado reports for a Quartus design', async () => {
    const a = write(ipYml('spike'), 'a', 'a.ip.yml');
    write(oocReport('sys_axi_gpio_0_0'), 'a', 'xilinx', 'build', 'ooc', 'utilization.rpt');
    expect(await discoverIpBuilds(withDefinitions(qsys, { '/pio_0': a }))).toEqual([]);
  });
});

describe('ipCoreBuildName', () => {
  it('is the lower-cased vlnv.name, or none', () => {
    expect(ipCoreBuildName({ vlnv: { name: 'My_Core' } })).toBe('my_core');
    expect(ipCoreBuildName({ vlnv: {} })).toBeUndefined();
    expect(ipCoreBuildName(null)).toBeUndefined();
    expect(ipCoreBuildName('text')).toBeUndefined();
  });
});
