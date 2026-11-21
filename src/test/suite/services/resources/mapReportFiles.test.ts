import { readBdJson } from '../../../../parser/system/BdJsonReader';
import { mapReportFiles } from '../../../../services/resources/mapReportFiles';
import { vivadoFixture } from './fixtures';

const bd = readBdJson(vivadoFixture('sys.bd'), 'sys.bd');
const file = (name: string, fixture = name) => ({ name, text: vivadoFixture(fixture) });

describe('mapReportFiles', () => {
  it('maps a hierarchical report and names the report file as its source', () => {
    const { report, notes } = mapReportFiles(bd, [file('download.txt', 'routed_hier.rpt')], {
      capacity: file('flat.rpt', 'routed_flat.rpt'),
    });
    expect(notes).toEqual([]);
    expect(report.source).toMatchObject({ fileName: 'download.txt', design: 'sys_wrapper' });
    expect(report.metrics[0]).toMatchObject({ key: 'lut', capacity: 63400 });
  });

  it('maps the per-IP reports by the Design of each, whatever the order', () => {
    const names = [
      'sys_smartconnect_0_0',
      'sys_bram_0_0',
      'sys_axi_gpio_0_0',
      'sys_axi_bram_ctrl_0_0',
    ];
    const { report } = mapReportFiles(
      bd,
      names.map((name) => file(`${name}.rpt`, `ooc/${name}_utilization_synth.rpt`))
    );
    expect(report.stage).toBe('ooc');
    expect(Object.keys(report.instances).sort()).toEqual([
      '/axi_bram_ctrl_0',
      '/axi_gpio_0',
      '/hier_0',
      '/hier_0/bram_0',
      '/smartconnect_0',
    ]);
  });

  it('notes an unused --capacity with per-IP reports', () => {
    const { notes } = mapReportFiles(
      bd,
      [file('a.rpt', 'ooc/sys_bram_0_0_utilization_synth.rpt')],
      { capacity: file('flat.rpt', 'routed_flat.rpt') }
    );
    expect(notes).toEqual([expect.stringContaining('--capacity is not used')]);
  });

  it('refuses --root with per-IP reports', () => {
    expect(() =>
      mapReportFiles(bd, [file('a.rpt', 'ooc/sys_bram_0_0_utilization_synth.rpt')], { root: 'x' })
    ).toThrow('--root applies to a hierarchical report');
  });

  it('refuses no report at all', () => {
    expect(() => mapReportFiles(bd, [])).toThrow('No report given');
  });
});
