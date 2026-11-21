import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readBdJson } from '../../../../parser/system/BdJsonReader';
import { readQsysTcl } from '../../../../parser/system/QsysTclReader';
import type { SystemGraph, SystemInstance } from '../../../../domain/systemGraph';
import {
  blockBuildOf,
  blockTypeName,
  rootMissingMessage,
} from '../../../../services/resources/blockBuild';
import { loadCandidate, mapLoaded } from '../../../../services/resources/loadResourceSource';
import { defaultSource, projectEntries } from '../../../../services/resources/resourceSources';
import { mapReportFiles } from '../../../../services/resources/mapReportFiles';
import { classifyReportFiles } from '../../../../services/resources/reportCandidates';
import { recognizeReport, type RecognizedReport } from '../../../../services/resources/reportKind';
import { quartusFixture, vivadoFixture } from './fixtures';

const IP = 'led_controller_avmm';
const fit = quartusFixture(`${IP}.fit.rpt`, IP);
const map = quartusFixture(`${IP}.map.rpt`, IP);
const summary = quartusFixture(`${IP}.fit.summary`, IP);

const qsysSystem = readQsysTcl(
  fs.readFileSync(
    path.join(__dirname, '../../../../../examples/led_avmm/altera/qsys/led_avmm_system.tcl'),
    'utf8'
  ),
  'led_avmm_system.tcl'
);
const bd = readBdJson(vivadoFixture('sys.bd'), 'sys.bd');

const recognized = (text: string): RecognizedReport => {
  const recognition = recognizeReport(text);
  if (!recognition.recognized) {
    throw new Error(recognition.message);
  }
  return recognition;
};

const instance = (patch: Partial<SystemInstance>): SystemInstance => ({
  path: '/x',
  name: 'x',
  parent: '/',
  kind: 'ip',
  parameters: {},
  pins: [],
  line: 1,
  ...patch,
});

const flatOf = (design: string): string =>
  vivadoFixture('ooc/sys_axi_gpio_0_0_utilization_synth.rpt').replace(
    /^(\|\s*Design\s*:\s*).*$/m,
    `$1${design}`
  );

describe('blockTypeName', () => {
  it('is the qsys component, the module reference or the vlnv name', () => {
    expect(blockTypeName(instance({ component: 'my_core' }))).toBe('my_core');
    expect(blockTypeName(instance({ kind: 'module', moduleRef: 'my_mod' }))).toBe('my_mod');
    expect(blockTypeName(instance({ vlnv: 'acme.com:ip:axi_gpio:2.0' }))).toBe('axi_gpio');
  });

  it('is none for a hierarchy or a blackbox', () => {
    expect(blockTypeName(instance({ kind: 'hier' }))).toBeUndefined();
    expect(blockTypeName(instance({ kind: 'blackbox', component: 'x' }))).toBeUndefined();
  });
});

describe('blockBuildOf', () => {
  it('finds the blocks a Quartus build of one IP core belongs to, fit and synthesis', () => {
    for (const text of [fit, map]) {
      expect(blockBuildOf(qsysSystem, recognized(text), text)).toEqual({
        top: IP,
        instances: ['/led_ctrl'],
      });
    }
  });

  it('compares the top and the IP type without regard to case', () => {
    const graph: SystemGraph = {
      ...qsysSystem,
      instances: { '/a': instance({ path: '/a', component: 'LED_Controller_AVMM' }) },
    };
    expect(blockBuildOf(graph, recognized(fit), fit)?.instances).toEqual(['/a']);
  });

  it('is not a block build when the design is in the report', () => {
    const graph = { ...qsysSystem, name: IP };
    expect(blockBuildOf(graph, recognized(fit), fit)).toBeUndefined();
  });

  it('is not a block build when no block is of that IP', () => {
    expect(blockBuildOf(bd, recognized(fit), fit)).toBeUndefined();
  });

  it('keeps a Vivado report whose Design is the xci name of a block out-of-context', () => {
    const text = flatOf('sys_axi_gpio_0_0');
    expect(blockBuildOf(bd, recognized(text), text)).toBeUndefined();
  });

  it('takes a flat Vivado report whose Design is the IP type of blocks', () => {
    const text = flatOf('axi_gpio');
    expect(blockBuildOf(bd, recognized(text), text)).toEqual({
      top: 'axi_gpio',
      instances: ['/axi_gpio_0', '/hier_0/axi_gpio_1'],
    });
  });

  it('is not a block build for a hierarchical Vivado report', () => {
    const text = vivadoFixture('routed_hier.rpt');
    expect(blockBuildOf(bd, recognized(text), text)).toBeUndefined();
  });
});

describe('rootMissingMessage', () => {
  it('says what the report is a build of, or that the design is missing', () => {
    expect(rootMissingMessage('sys', 'axi_gpio')).toBe(
      'This report is a build of axi_gpio, not of the design sys'
    );
    expect(rootMissingMessage('sys', 'sys')).toBe('The design sys is not in this report');
    expect(rootMissingMessage('sys')).toBe('The design sys is not in this report');
    expect(rootMissingMessage('sys', '')).toBe('The design sys is not in this report');
  });
});

describe('block builds attached as report files', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-blockbuild-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const put = (name: string, text: string): string => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return file;
  };

  const alm = (report: { metrics: Array<{ label: string }> }): number =>
    report.metrics.findIndex((metric) => metric.label === 'ALMs');

  it('lists the fit and the map report as usable block builds', async () => {
    const files = [
      put(`${IP}.fit.rpt`, fit),
      put(`${IP}.fit.summary`, summary),
      put(`${IP}.map.rpt`, map),
    ];
    const found = await classifyReportFiles(files, qsysSystem, { refusals: 'all' });
    expect(found.map((c) => [c.group, c.usable, c.stage, path.basename(c.files[0])])).toEqual([
      ['blockBuild', true, 'fit', `${IP}.fit.rpt`],
      ['blockBuild', true, 'synth', `${IP}.map.rpt`],
    ]);
    const [fitBuild, mapBuild] = found;
    expect(fitBuild.label).toBe(`Fitter, build of ${IP} (${IP}.fit.rpt)`);
    expect(fitBuild.capacityFile).toBe(files[1]);
    expect(fitBuild.builds).toEqual([
      { instances: ['/led_ctrl'], file: files[0], capacityFile: files[1] },
    ]);
    expect(mapBuild.capacityFile).toBe(files[1]);
  });

  it('maps the fit build onto the block with the capacity of the summary', async () => {
    const files = [put(`${IP}.fit.rpt`, fit), put(`${IP}.fit.summary`, summary)];
    const [candidate] = await classifyReportFiles(files, qsysSystem, { refusals: 'all' });
    const report = mapLoaded(await loadCandidate(candidate, 'x'), qsysSystem);
    expect(report.stage).toBe('ooc');
    expect(report.source.design).toBeUndefined();
    expect(report.instances['/led_ctrl'].total[alm(report)]).toBeCloseTo(60.5);
    expect(report.metrics[alm(report)].capacity).toBe(41910);
    expect(report.notInReport).toContain('/nios2');
    expect(report.notInReport).not.toContain('/led_ctrl');
  });

  it('reads the synthesis columns of the map build', async () => {
    const [candidate] = await classifyReportFiles([put(`${IP}.map.rpt`, map)], qsysSystem, {
      refusals: 'all',
    });
    const report = mapLoaded(await loadCandidate(candidate, 'x'), qsysSystem);
    const labels = report.metrics.map((metric) => metric.label);
    expect(labels).toContain('ALUTs');
    expect(labels).not.toContain('ALMs');
    expect(report.notInReport).toContain('/nios2');
  });

  it('lists a flat Vivado build of an IP core without a capacity file', async () => {
    const flat = put('utilization.rpt', flatOf('axi_gpio'));
    const found = await classifyReportFiles([flat], bd, { refusals: 'all' });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ group: 'blockBuild', usable: true, vendor: 'vivado' });
    expect(found[0].capacityFile).toBeUndefined();
    expect(found[0].builds).toEqual([
      { instances: ['/axi_gpio_0', '/hier_0/axi_gpio_1'], file: flat },
    ]);
  });

  it('is the default source only when no source of the whole design is usable', async () => {
    const [fitBuild] = await classifyReportFiles([put(`${IP}.fit.rpt`, fit)], qsysSystem, {
      refusals: 'all',
    });
    const design = {
      ...fitBuild,
      id: 'design',
      group: 'hierarchy' as const,
      stage: 'synth' as const,
    };
    const rel = (file: string): string => file;
    expect(defaultSource(projectEntries([fitBuild], rel))).toBe(`project:${fitBuild.id}`);
    expect(defaultSource(projectEntries([fitBuild, design], rel))).toBe('project:design');
    expect(defaultSource(projectEntries([design, fitBuild], rel))).toBe('project:design');
  });

  it('still refuses a flat Vivado report of no block', async () => {
    const found = await classifyReportFiles([put('utilization.rpt', flatOf('other'))], bd, {
      refusals: 'all',
    });
    expect(found[0]).toMatchObject({ group: 'hierarchy', usable: false });
  });
});

describe('mapReportFiles with a block build', () => {
  const file = (name: string, text: string) => ({ name, text });

  it('maps the fit report onto the block, with --capacity as the device capacity', () => {
    const { report, notes } = mapReportFiles(qsysSystem, [file('a.fit.rpt', fit)], {
      capacity: file('a.fit.summary', summary),
    });
    expect(notes).toEqual([]);
    const at = report.metrics.findIndex((metric) => metric.label === 'ALMs');
    expect(report.stage).toBe('ooc');
    expect(report.instances['/led_ctrl'].total[at]).toBeCloseTo(60.5);
    expect(report.metrics[at].capacity).toBe(41910);
    expect(report.notInReport).toContain('/clk_0');
  });

  it('notes an unused --capacity for a Vivado build', () => {
    const { notes } = mapReportFiles(bd, [file('u.rpt', flatOf('axi_gpio'))], {
      capacity: file('s.fit.summary', summary),
    });
    expect(notes).toEqual([expect.stringContaining('--capacity is not used')]);
  });

  it('refuses to mix a block build with a hierarchical report', () => {
    expect(() =>
      mapReportFiles(bd, [
        file('h.rpt', vivadoFixture('routed_hier.rpt')),
        file('u.rpt', flatOf('axi_gpio')),
      ])
    ).toThrow('Cannot mix the hierarchical report h.rpt');
  });
});
