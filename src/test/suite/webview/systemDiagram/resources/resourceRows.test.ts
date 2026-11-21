import type { ResourceReport } from '../../../../../domain/resourceUsage';
import {
  changeText,
  metricText,
  resourceRows,
  sortRows,
} from '../../../../../webview/systemDiagram/resources/resourceRows';
import {
  oocReport,
  quartusGraph,
  quartusReport,
  vivadoGraph,
  vivadoReport,
} from './resourceReports';

describe('resourceRows', () => {
  const rows = resourceRows(quartusReport, quartusGraph);

  it('lists the blocks, what the tool generated, the outside logic, then the design', () => {
    expect(rows.map((row) => [row.kind, row.name, row.level])).toEqual([
      ['block', 'bridge_0', '/'],
      ['block', 'pio_0', '/'],
      ['block', 'pio_1', '/'],
      ['block', 'ram_0', '/'],
      ['other', 'rst_controller', '/'],
      ['other', 'mm_interconnect_0', '/'],
      ['outside', 'Outside the design', ''],
      ['design', 'sys', ''],
    ]);
    expect(rows.find((row) => row.name === 'pio_0')).toMatchObject({ path: '/pio_0' });
  });

  it('carries the primary totals and the share of the design in the first metric', () => {
    const bridge = rows.find((row) => row.name === 'bridge_0')!;
    expect(bridge.values[0]).toBeCloseTo(50.4);
    expect(bridge.values).toHaveLength(4);
    expect(bridge.share).toBeCloseTo(50.4 / 114.1);
    expect(rows.find((row) => row.kind === 'design')?.share).toBe(1);
    expect(rows.find((row) => row.kind === 'outside')?.share).toBeUndefined();
  });

  it('carries the share of the device of each primary metric, aligned with the values', () => {
    const bridge = rows.find((row) => row.name === 'bridge_0')!;
    expect(bridge.deviceShares).toHaveLength(bridge.values.length);
    expect(bridge.deviceShares[0]).toBeCloseTo(50.4 / 32070);
    // Registers have no capacity in the fitter summary.
    expect(bridge.deviceShares[1]).toBeUndefined();
    expect(rows.find((row) => row.name === 'ram_0')?.deviceShares[2]).toBeCloseTo(8 / 397);
  });

  it('gives the design row and the outside row their device shares', () => {
    const design = rows.find((row) => row.kind === 'design')!;
    const outside = rows.find((row) => row.kind === 'outside')!;
    expect(design.deviceShares[0]).toBeCloseTo(quartusReport.design.total[0] / 32070);
    expect(outside.deviceShares[0]).toBeCloseTo((quartusReport.outside as number[])[0] / 32070);
  });

  it('has no device share for a summed row', () => {
    const summed = resourceRows(oocReport, vivadoGraph).find((row) => row.path === '/hier_0')!;
    expect(summed.summed).toBe(true);
    expect(summed.deviceShares).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('lists every block of a design with hierarchy, with the level that holds it', () => {
    const nested = resourceRows(vivadoReport, vivadoGraph).find(
      (row) => row.path === '/hier_0/bram_0'
    );
    expect(nested).toMatchObject({ name: 'bram_0', level: '/hier_0' });
  });
});

describe('sortRows', () => {
  const rows = resourceRows(quartusReport, quartusGraph);
  const names = (list: typeof rows) => list.map((row) => row.name);

  it('orders by a metric and keeps the design row last', () => {
    expect(names(sortRows(rows, 0, 'desc')).slice(0, 3)).toEqual([
      'bridge_0',
      'mm_interconnect_0',
      'pio_1',
    ]);
    expect(names(sortRows(rows, 0, 'asc')).at(-1)).toBe('sys');
  });

  it('orders a metric column by its count, whatever its share of the device', () => {
    // Registers have no capacity, but they are counted.
    expect(names(sortRows(rows, 1, 'desc')).slice(0, 2)).toEqual(['bridge_0', 'mm_interconnect_0']);
  });

  it('orders by name', () => {
    expect(names(sortRows(rows, 'name', 'asc')).slice(0, 2)).toEqual([
      'bridge_0',
      'mm_interconnect_0',
    ]);
  });

  it('is stable for equal values', () => {
    expect(names(sortRows(rows, 2, 'desc')).slice(1)).toEqual([
      'bridge_0',
      'pio_0',
      'pio_1',
      'rst_controller',
      'mm_interconnect_0',
      'Outside the design',
      'sys',
    ]);
  });
});

describe('resourceRows with a compared report', () => {
  const withTotals = (
    report: ResourceReport,
    path: string,
    total: number[],
    extra: Partial<ResourceReport> = {}
  ): ResourceReport => ({
    ...report,
    ...extra,
    instances: { ...report.instances, [path]: { total } },
  });
  const find = (rows: ReturnType<typeof resourceRows>, name: string) =>
    rows.find((row) => row.name === name)!;
  const texts = (row: ReturnType<typeof find>) =>
    row.changes!.map((_, index) => changeText(row, index));

  it('has no change field without a compared report', () => {
    const row = find(resourceRows(vivadoReport, vivadoGraph), 'smartconnect_0');
    expect(row).not.toHaveProperty('changes');
    expect(changeText(row, 0)).toBeUndefined();
  });

  it('gives a block row the change of each primary metric, selected minus compared', () => {
    const compared = withTotals(vivadoReport, '/smartconnect_0', [368, 449, 1, 0, 0, 0, 0]);
    const rows = resourceRows(vivadoReport, vivadoGraph, compared);
    expect(texts(find(rows, 'smartconnect_0'))).toEqual(['+54', '0', '-1', '0']);
    expect(texts(find(rows, 'axi_gpio_0'))).toEqual(['0', '0', '0', '0']);
  });

  it('gives the design row the change of the design total', () => {
    const compared = {
      ...vivadoReport,
      design: { total: [900, 1386, 2, 0, 0, 0, 0] },
    };
    const rows = resourceRows(vivadoReport, vivadoGraph, compared);
    expect(texts(find(rows, vivadoGraph.name))).toEqual(['-59', '0', '0', '0']);
  });

  it('matches an other row by level and name, and an outside row as such', () => {
    const usage = (lut: number) => ({ total: [lut, 0, 0, 0, 0, 0, 0] });
    const selected: ResourceReport = {
      ...vivadoReport,
      others: [
        { level: '/', name: 'ic', usage: usage(10) },
        { level: '/hier_0', name: 'ic', usage: usage(7) },
      ],
      outside: [5, 0, 0, 0, 0, 0, 0],
    };
    const compared: ResourceReport = {
      ...vivadoReport,
      others: [{ level: '/', name: 'ic', usage: usage(4) }],
      outside: [8, 0, 0, 0, 0, 0, 0],
    };
    const rows = resourceRows(selected, vivadoGraph, compared);
    const others = rows.filter((row) => row.kind === 'other');
    expect(texts(others[0])[0]).toBe('+6');
    expect(texts(others[1])).toEqual(['\u2014', '\u2014', '\u2014', '\u2014']);
    expect(texts(rows.find((row) => row.kind === 'outside')!)[0]).toBe('-3');
    const bare = resourceRows(selected, vivadoGraph, { ...vivadoReport, others: [] });
    expect(texts(bare.find((row) => row.kind === 'outside')!)[0]).toBe('\u2014');
  });

  it('has an em dash for a block or a metric the compared report lacks', () => {
    const { '/smartconnect_0': _gone, ...instances } = vivadoReport.instances;
    const rows = resourceRows(vivadoReport, vivadoGraph, { ...vivadoReport, instances });
    expect(texts(find(rows, 'smartconnect_0'))).toEqual(['\u2014', '\u2014', '\u2014', '\u2014']);
    const noLut = resourceRows(vivadoReport, vivadoGraph, {
      ...vivadoReport,
      metrics: vivadoReport.metrics.map((metric) =>
        metric.key === 'lut' ? { ...metric, key: 'other' } : metric
      ),
    });
    expect(texts(find(noLut, 'smartconnect_0'))).toEqual(['\u2014', '0', '0', '0']);
  });
});

describe('metricText', () => {
  it('is the count with its share of the device', () => {
    const rows = resourceRows(vivadoReport, vivadoGraph);
    const smart = rows.find((row) => row.name === 'smartconnect_0')!;
    expect(metricText(smart, 0)).toBe('422 (0.7 %)');
    expect(metricText(smart, 2)).toBe('0 (0 %)');
    expect(metricText(rows.find((row) => row.kind === 'design')!, 0)).toBe('841 (1.3 %)');
  });

  it('leaves out the share where it is unknown', () => {
    const quartus = resourceRows(quartusReport, quartusGraph);
    // Registers have no capacity in the fitter summary.
    expect(metricText(quartus.find((row) => row.name === 'bridge_0')!, 1)).toBe('137');
    const summed = resourceRows(oocReport, vivadoGraph).find((row) => row.path === '/hier_0')!;
    expect(metricText(summed, 0)).toBe('5');
  });
});
