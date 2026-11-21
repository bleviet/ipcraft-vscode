import { readBdJson } from '../../../../parser/system/BdJsonReader';
import { readBdTcl } from '../../../../parser/system/BdTclReader';
import { readQsys } from '../../../../parser/system/QsysReader';
import type { ResourceReport } from '../../../../domain/resourceUsage';
import type { SystemGraph } from '../../../../domain/systemGraph';
import { mapHierarchyReport, mapOocReports } from '../../../../services/resources/mapReportToGraph';
import type { ParsedTable } from '../../../../services/resources/reportTree';
import { quartusFixture, vivadoFixture } from './fixtures';
import { parseQuartusEntities } from '../../../../services/resources/quartusEntityTable';
import {
  readQuartusCapacity,
  readVivadoFlat,
} from '../../../../services/resources/resourceMetrics';
import { parseVivadoHierarchy } from '../../../../services/resources/vivadoHierarchyTable';

const source = { fileName: 'report.rpt' };

function metricIndex(report: ResourceReport, label: string): number {
  const index = report.metrics.findIndex((m) => m.label === label);
  if (index < 0) {
    throw new Error(`no metric ${label}`);
  }
  return index;
}

function value(report: ResourceReport, path: string, label: string): number {
  const usage = report.instances[path];
  if (!usage) {
    throw new Error(`no usage for ${path}`);
  }
  return usage.total[metricIndex(report, label)];
}

function mapVivado(graph: SystemGraph, file: string, chosenRoot?: string): ResourceReport {
  return mapHierarchyReport(
    {
      table: parseVivadoHierarchy(vivadoFixture(file)),
      vendor: 'vivado',
      stage: file.startsWith('synth') ? 'synth' : 'routed',
      source,
      capacity: readVivado('routed_flat.rpt'),
    },
    graph,
    chosenRoot
  );
}

const readVivado = (file: string) => readVivadoFlat(vivadoFixture(file)).capacity;

const bd = readBdJson(vivadoFixture('sys.bd'), 'sys.bd');
const bdTcl = readBdTcl(vivadoFixture('sys.tcl'), 'sys.tcl');

describe('mapHierarchyReport: Vivado', () => {
  const report = mapVivado(bd, 'routed_hier.rpt');

  it('finds the design root by module name', () => {
    expect(report.rootCandidates).toEqual(['sys_wrapper/sys_i']);
    expect(report.root).toBe('sys_wrapper/sys_i');
  });

  it('maps blocks and hierarchy blocks to the report totals', () => {
    expect(value(report, '/axi_bram_ctrl_0', 'LUTs')).toBe(154);
    expect(value(report, '/smartconnect_0', 'LUTs')).toBe(422);
    expect(value(report, '/hier_0', 'LUTs')).toBe(135);
    expect(value(report, '/hier_0/bram_0', 'BRAM')).toBe(2);
    expect(value(report, '/hier_0/axi_gpio_1', 'LUTs')).toBe(131);
    expect(report.design.total[metricIndex(report, 'LUTs')]).toBe(841);
  });

  it('has no leftovers and no warnings', () => {
    expect(report.others).toEqual([]);
    expect(report.diagnostics).toEqual([]);
    expect(report.notInReport).toEqual([]);
    expect(report.outside).toBeUndefined();
    expect(report.stage).toBe('routed');
  });

  it('takes the device capacity from a flat report', () => {
    expect(report.metrics.find((m) => m.label === 'LUTs')?.capacity).toBe(63400);
  });

  it('maps the same numbers for a block design read from Tcl (no xci_name)', () => {
    const fromTcl = mapVivado(bdTcl, 'routed_hier.rpt');
    expect(fromTcl.instances).toEqual(report.instances);
    expect(fromTcl.diagnostics).toEqual([]);
  });

  it('shows the synthesis numbers of a synthesis report', () => {
    const synth = mapVivado(bd, 'synth_hier.rpt');
    expect(synth.stage).toBe('synth');
    expect(value(synth, '/axi_bram_ctrl_0', 'LUTs')).toBe(188);
  });

  it('fills self from the (name) rows', () => {
    const synth = mapVivado(bd, 'synth_hier.rpt');
    expect(synth.instances['/hier_0'].self?.[metricIndex(synth, 'LUTs')]).toBe(0);
  });
});

describe('mapHierarchyReport: xci_name check', () => {
  it('warns once when the module of a cell differs from its xci_name', () => {
    const graph = JSON.parse(JSON.stringify(bd)) as SystemGraph;
    graph.instances['/axi_gpio_0'].xciName = 'sys_axi_gpio_9_9';
    const report = mapVivado(graph, 'routed_hier.rpt');
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0].severity).toBe('warning');
    expect(report.diagnostics[0].message).toContain('sys_axi_gpio_9_9');
    expect(report.diagnostics[0].message).toContain('sys_axi_gpio_0_0');
    expect(report.instances['/axi_gpio_0']).toBeDefined();
  });
});

describe('mapHierarchyReport: hierarchy totals', () => {
  it('takes the total of a hierarchy block from the report, never from its children', () => {
    const table: ParsedTable = {
      columns: ['Total LUTs'],
      root: {
        name: 'top',
        module: 'sys',
        total: [100],
        children: [
          {
            name: 'hier_0',
            module: 'hier_0_imp_X',
            total: [100],
            children: [
              { name: 'axi_gpio_1', module: 'sys_axi_gpio_1_0', total: [30], children: [] },
            ],
          },
        ],
      },
    };
    const report = mapHierarchyReport({ table, vendor: 'vivado', stage: 'routed', source }, bd);
    expect(report.instances['/hier_0'].total).toEqual([100]);
    expect(report.instances['/hier_0/axi_gpio_1'].total).toEqual([30]);
  });
});

describe('mapHierarchyReport: several candidate roots', () => {
  const node = (name: string, module: string, lut: number) => ({
    name,
    module,
    total: [lut],
    children: [] as ParsedTable['root'][],
  });
  const table: ParsedTable = {
    columns: ['Total LUTs'],
    root: {
      ...node('top', '(top)', 30),
      children: [
        { ...node('a', 'sys', 10), children: [node('axi_gpio_0', 'sys_axi_gpio_0_0', 7)] },
        { ...node('b', 'sys', 20), children: [node('axi_gpio_0', 'sys_axi_gpio_0_0', 17)] },
      ],
    },
  };
  const input = { table, vendor: 'vivado' as const, stage: 'synth' as const, source };

  it('lists every candidate and uses the first by default', () => {
    const report = mapHierarchyReport(input, bd);
    expect(report.rootCandidates).toEqual(['top/a', 'top/b']);
    expect(report.root).toBe('top/a');
    expect(report.instances['/axi_gpio_0'].total).toEqual([7]);
    expect(report.outside).toEqual([20]);
  });

  it('uses the chosen candidate', () => {
    const report = mapHierarchyReport(input, bd, 'top/b');
    expect(report.root).toBe('top/b');
    expect(report.instances['/axi_gpio_0'].total).toEqual([17]);
    expect(report.outside).toEqual([10]);
  });

  it('falls back to the first candidate when the choice is not one', () => {
    expect(mapHierarchyReport(input, bd, 'top/zzz').root).toBe('top/a');
  });
});

describe('mapHierarchyReport: design not in the report', () => {
  it('warns and maps nothing', () => {
    const report = mapHierarchyReport(
      {
        table: parseVivadoHierarchy(vivadoFixture('routed_hier.rpt')),
        vendor: 'vivado',
        stage: 'routed',
        source,
      },
      { ...bd, name: 'other_design' }
    );
    expect(report.rootCandidates).toEqual([]);
    expect(report.root).toBeUndefined();
    expect(report.instances).toEqual({});
    expect(report.design.total.every((v) => v === 0)).toBe(true);
    expect(report.diagnostics).toEqual([
      {
        severity: 'warning',
        message: 'This report is a build of sys_wrapper, not of the design other_design',
      },
    ]);
  });
});

describe('mapHierarchyReport: Quartus', () => {
  const qsys = readQsys(quartusFixture('sys.qsys'), 'sys.qsys');
  const report = mapHierarchyReport(
    {
      table: parseQuartusEntities(quartusFixture('spike.fit.rpt')),
      vendor: 'quartus',
      stage: 'fit',
      source,
      capacity: readQuartusCapacity(quartusFixture('spike.fit.summary')),
    },
    qsys
  );

  it('finds the design by entity', () => {
    expect(report.rootCandidates).toEqual(['|top|sys:u0']);
    expect(report.root).toBe('|top|sys:u0');
  });

  it('maps blocks by instance name', () => {
    expect(value(report, '/pio_0', 'ALMs')).toBeCloseTo(4.8);
    expect(value(report, '/bridge_0', 'ALMs')).toBeCloseTo(50.4);
    expect(value(report, '/ram_0', 'M10Ks')).toBe(8);
  });

  it('lists logic the tool generated, per level', () => {
    const alm = metricIndex(report, 'ALMs');
    const byName = Object.fromEntries(report.others.map((o) => [o.name, o]));
    expect(byName.mm_interconnect_0.level).toBe('/');
    expect(byName.mm_interconnect_0.module).toBe('sys_mm_interconnect_0');
    expect(byName.rst_controller.level).toBe('/');
    expect(byName.mm_interconnect_0.usage.total[alm]).toBeCloseTo(46.2);
    expect(byName.rst_controller.usage.total[alm]).toBeCloseTo(3.0);
  });

  it('lists blocks with no row', () => {
    expect(report.notInReport).toContain('/clk_0');
    expect(report.notInReport).not.toContain('/pio_0');
    expect(report.diagnostics).toEqual([]);
  });

  it('has no self figure for a single-valued metric, also on the design', () => {
    const m10k = metricIndex(report, 'M10Ks');
    expect(report.design.self?.[m10k]).toBeNull();
    expect(report.design.self?.[metricIndex(report, 'ALMs')]).toBeCloseTo(0);
    expect(report.instances['/ram_0'].self?.[m10k]).toBeNull();
    expect(report.instances['/ram_0'].self?.[metricIndex(report, 'ALMs')]).toBeCloseTo(0.3);
  });

  it('reports the logic outside the design', () => {
    const alm = metricIndex(report, 'ALMs');
    expect(report.outside?.[alm]).toBeCloseTo(120.5 - 114.1);
    expect(report.design.total[alm]).toBeCloseTo(114.1);
  });

  it('takes the capacity from the fitter summary', () => {
    expect(report.metrics.find((m) => m.label === 'ALMs')?.capacity).toBe(32070);
    expect(report.metrics.find((m) => m.label === 'Registers')?.capacity).toBeUndefined();
  });

  it('maps the synthesis report with its own metrics', () => {
    const synth = mapHierarchyReport(
      {
        table: parseQuartusEntities(quartusFixture('spike.map.rpt')),
        vendor: 'quartus',
        stage: 'synth',
        source,
      },
      qsys
    );
    expect(value(synth, '/pio_0', 'ALUTs')).toBe(11);
    expect(value(synth, '/ram_0', 'Block Memory Bits')).toBe(65536);
  });
});

describe('mapOocReports', () => {
  const reports = [
    'sys_axi_gpio_0_0',
    'sys_axi_bram_ctrl_0_0',
    'sys_bram_0_0',
    'sys_smartconnect_0_0',
  ].map((design) => ({
    design,
    text: vivadoFixture(`ooc/${design}_utilization_synth.rpt`),
  }));
  const report = mapOocReports(reports, bd, source);

  it('maps each IP report to the block with that xci_name', () => {
    expect(report.stage).toBe('ooc');
    expect(value(report, '/axi_gpio_0', 'LUTs')).toBe(131);
    expect(value(report, '/axi_bram_ctrl_0', 'LUTs')).toBe(188);
    expect(value(report, '/smartconnect_0', 'LUTs')).toBe(464);
    expect(report.instances['/axi_gpio_0'].summed).toBeUndefined();
  });

  it('sums the IPs inside a hierarchy block and marks the sum', () => {
    expect(report.instances['/hier_0'].summed).toBe(true);
    expect(value(report, '/hier_0', 'LUTs')).toBe(5);
    expect(value(report, '/hier_0', 'BRAM')).toBe(2);
  });

  it('sums the design and marks it', () => {
    expect(report.design.summed).toBe(true);
    expect(report.design.total[metricIndex(report, 'LUTs')]).toBe(131 + 188 + 464 + 5);
  });

  it('lists the IPs without a report', () => {
    expect(report.notInReport).toEqual(['/hier_0/axi_gpio_1']);
  });

  it('takes the capacity from the IP reports', () => {
    expect(report.metrics.find((m) => m.label === 'LUTs')?.capacity).toBe(63400);
  });

  it('lists a hierarchy block with no IP report as not in the report', () => {
    const only = mapOocReports([reports[0]], bd, source);
    expect(only.instances['/hier_0']).toBeUndefined();
    expect(only.notInReport).toContain('/hier_0');
    expect(only.rootCandidates).toEqual([]);
  });
});
