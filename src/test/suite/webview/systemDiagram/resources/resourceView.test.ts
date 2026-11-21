import type { ResourceReport } from '../../../../../domain/resourceUsage';
import {
  detailRows,
  deviceShare,
  formatChange,
  formatCount,
  formatPercent,
  formatShare,
  headerTitle,
  notInReportNote,
  nodeResources,
  primaryMetrics,
  stageLabel,
  toolbarChip,
} from '../../../../../webview/systemDiagram/resources/resourceView';
import { oocReport, quartusReport, vivadoReport } from './resourceReports';

const resources = (report?: ResourceReport) => ({
  sources: [],
  searched: [],
  hierarchicalTcl: '',
  ...(report && { report }),
});

describe('formatCount', () => {
  it('keeps integers as they are up to 9999', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(154)).toBe('154');
    expect(formatCount(9999)).toBe('9999');
  });

  it('abbreviates thousands and millions', () => {
    expect(formatCount(12345)).toBe('12.3k');
    expect(formatCount(20000)).toBe('20k');
    expect(formatCount(1234567)).toBe('1.2M');
    expect(formatCount(999999)).toBe('1M');
  });

  it('writes a fraction with one decimal', () => {
    expect(formatCount(50.4)).toBe('50.4');
    expect(formatCount(114.1)).toBe('114.1');
    expect(formatCount(3.0000001)).toBe('3');
  });
});

describe('formatPercent and stageLabel', () => {
  it('writes one decimal, and a floor for a figure that rounds to zero', () => {
    expect(formatPercent(0.183)).toBe('18.3 %');
    expect(formatPercent(0)).toBe('0 %');
    expect(formatPercent(0.0001)).toBe('< 0.1 %');
  });

  it('names every stage', () => {
    expect(['ooc', 'synth', 'placed', 'routed', 'fit'].map((s) => stageLabel(s as never))).toEqual([
      'Per block',
      'Post-synthesis',
      'Post-placement',
      'Post-route',
      'Fitter',
    ]);
  });
});

describe('primaryMetrics', () => {
  it('lists the four primary metrics in order', () => {
    expect(primaryMetrics(vivadoReport).map((m) => m.label)).toEqual([
      'LUTs',
      'FFs',
      'BRAM',
      'DSPs',
    ]);
    expect(primaryMetrics(quartusReport).map((m) => m.label)).toEqual([
      'ALMs',
      'Registers',
      'M10Ks',
      'DSP Blocks',
    ]);
  });
});

describe('nodeResources', () => {
  it('shows the four primary values and the share of the design for a block of the root', () => {
    const node = nodeResources(vivadoReport, '/axi_bram_ctrl_0');
    expect(node?.share).toBeCloseTo(154 / 841);
    expect(node?.notInReport).toBe(false);
    expect(node?.strip).toBe('154 LUT · 168 FF · 0 BRAM · 0 DSP');
    expect(node?.shares).toBe('18.3 % design · 0.2 % device');
  });

  it('takes the share of a block inside a hierarchy from that hierarchy', () => {
    const node = nodeResources(vivadoReport, '/hier_0/bram_0');
    expect(node?.share).toBeCloseTo(4 / 135);
  });

  it('marks the sum of the IPs inside an out-of-context hierarchy', () => {
    const node = nodeResources(oocReport, '/hier_0');
    expect(node?.strip).toBe('Σ 5 LUT · 6 FF · 2 BRAM · 0 DSP');
    expect(node?.shares).toBe('0.6 % design');
    expect(node?.title).toContain('Sum of the blocks inside');
  });

  it('marks a block with no row in the report', () => {
    const node = nodeResources(quartusReport, '/clk_0');
    expect(node).toMatchObject({ notInReport: true });
    expect(node?.strip).toBe('not in report');
    expect(node?.shares).toBeUndefined();
  });

  it('derives the short labels of Quartus from the metric keys', () => {
    const node = nodeResources(quartusReport, '/bridge_0');
    expect(node?.strip).toBe('50.4 ALM · 137 Reg · 0 M10K · 0 DSP');
    expect(node?.shares).toBe('44.2 % design · 0.2 % device');
  });

  it('says no block report, in words of no vendor, for a block the per-block stage lacks', () => {
    const node = nodeResources(oocReport, '/hier_0/axi_gpio_1');
    expect(node).toMatchObject({ notInReport: true, strip: 'no block report' });
    expect(node?.title).toBe(notInReportNote(oocReport));
    // The tooltip names the out-of-context run and the IP cache only for Vivado.
    expect(notInReportNote({ stage: 'ooc', vendor: 'vivado' })).toBe(
      'No report of this block on its own: it has no build of its own, it was not synthesized out of context, or its run was an IP cache hit.'
    );
    expect(notInReportNote({ stage: 'ooc', vendor: 'quartus' })).toBe(
      'No report of this block on its own: it has no build of its own.'
    );
    expect(notInReportNote({ stage: 'routed', vendor: 'vivado' })).toMatch(
      /^Not in the report: no logic left/
    );
  });

  it('adds the share of the design and of the device of the first metric to the counts', () => {
    expect(nodeResources(vivadoReport, '/smartconnect_0')).toMatchObject({
      strip: '422 LUT · 449 FF · 0 BRAM · 0 DSP',
      shares: '50.2 % design · 0.7 % device',
    });
    expect(nodeResources(vivadoReport, '/hier_0/bram_0')).toMatchObject({
      strip: '4 LUT · 5 FF · 2 BRAM · 0 DSP',
      shares: '0.5 % design · < 0.1 % device',
    });
  });

  it('leaves out the share of the design when the block has no usage of the metric', () => {
    expect(nodeResources(vivadoReport, '/axi_bram_ctrl_0')?.shares).toContain(' % design');
    const report: ResourceReport = {
      ...vivadoReport,
      instances: { '/a': { total: [0, 5, 0, 0, 0, 0, 0] } },
    };
    expect(nodeResources(report, '/a')).toMatchObject({
      strip: '0 LUT · 5 FF · 0 BRAM · 0 DSP',
      shares: '0 % device',
    });
    const empty: ResourceReport = { ...vivadoReport, design: { total: [0, 0, 0, 0, 0, 0, 0] } };
    expect(nodeResources(empty, '/axi_bram_ctrl_0')?.shares).toBe('0.2 % device');
  });

  it('leaves out the share of the device when the first metric has no capacity', () => {
    const bare: ResourceReport = {
      ...vivadoReport,
      metrics: vivadoReport.metrics.map(({ capacity: _capacity, ...metric }) => metric),
    };
    expect(nodeResources(bare, '/axi_bram_ctrl_0')?.shares).toBe('18.3 % design');
  });

  it('has no second line when the block has neither share', () => {
    const bare: ResourceReport = {
      ...vivadoReport,
      metrics: vivadoReport.metrics.map(({ capacity: _capacity, ...metric }) => metric),
      design: { total: [0, 0, 0, 0, 0, 0, 0] },
    };
    const node = nodeResources(bare, '/axi_bram_ctrl_0');
    expect(node?.strip).toBe('154 LUT · 168 FF · 0 BRAM · 0 DSP');
    expect(node).not.toHaveProperty('shares');
  });

  it('leaves the notes of a block with no row as they are', () => {
    expect(nodeResources(quartusReport, '/clk_0')?.strip).toBe('not in report');
    expect(nodeResources(oocReport, '/hier_0/axi_gpio_1')?.strip).toBe('no block report');
  });

  it('says nothing about a path the report does not know', () => {
    expect(nodeResources(vivadoReport, '/nope')).toBeUndefined();
  });

  it('clamps the share to [0, 1]', () => {
    const report: ResourceReport = {
      ...vivadoReport,
      instances: { '/axi_bram_ctrl_0': { total: [900, 0, 0, 0, 0, 0, 0] } },
    };
    expect(nodeResources(report, '/axi_bram_ctrl_0')?.share).toBe(1);
  });

  it('leaves out the share when the level has no usage', () => {
    const report: ResourceReport = {
      ...vivadoReport,
      design: { total: [0, 0, 0, 0, 0, 0, 0] },
    };
    expect(nodeResources(report, '/axi_bram_ctrl_0')?.share).toBeUndefined();
  });
});

describe('deviceShare and formatShare', () => {
  it('is the total over the capacity of the metric', () => {
    const usage = vivadoReport.instances['/axi_bram_ctrl_0'];
    expect(deviceShare(vivadoReport, usage, 0)).toBeCloseTo(154 / 63400);
    expect(deviceShare(vivadoReport, usage, 2)).toBe(0);
  });

  it('is undefined for a metric with no capacity', () => {
    const usage = vivadoReport.instances['/axi_bram_ctrl_0'];
    expect(vivadoReport.metrics[4].capacity).toBeUndefined();
    expect(deviceShare(vivadoReport, usage, 4)).toBeUndefined();
    expect(deviceShare(vivadoReport, usage, 99)).toBeUndefined();
    expect(deviceShare(quartusReport, quartusReport.instances['/bridge_0'], 1)).toBeUndefined();
  });

  it('is undefined for the sum of an out-of-context hierarchy, but not for one of its IPs', () => {
    expect(deviceShare(oocReport, oocReport.instances['/hier_0'], 0)).toBeUndefined();
    expect(deviceShare(oocReport, oocReport.design, 0)).toBeUndefined();
    expect(deviceShare(oocReport, oocReport.instances['/axi_gpio_0'], 0)).toBeCloseTo(131 / 63400);
  });

  it('clamps to [0, 1]', () => {
    expect(deviceShare(vivadoReport, { total: [90000, 0, 0, 0, 0, 0, 0] }, 0)).toBe(1);
  });

  it('formats a share, and an em dash for a missing one', () => {
    expect(formatShare(0.011)).toBe('1.1 %');
    expect(formatShare(undefined)).toBe('\u2014');
  });
});

describe('headerTitle', () => {
  it('lists the stage and every primary figure with its share of the design', () => {
    const title = headerTitle(vivadoReport, '/axi_bram_ctrl_0');
    expect(title.startsWith('Post-route: LUTs 154 (18.3 % of design, ')).toBe(true);
    expect(title.endsWith('BRAM 0 (0 % of device), DSPs 0 (0 % of device)')).toBe(true);
  });

  it('adds the share of the device to each figure', () => {
    expect(headerTitle(vivadoReport, '/axi_bram_ctrl_0')).toBe(
      'Post-route: LUTs 154 (18.3 % of design, 0.2 % of device), FFs 168 (12.1 % of design, 0.1 % of device), BRAM 0 (0 % of device), DSPs 0 (0 % of device)'
    );
  });

  it('leaves out the share of the device where it is unknown', () => {
    // Quartus Registers have no capacity; an OOC sum is not placed on the device.
    expect(headerTitle(quartusReport, '/bridge_0')).toContain(
      'Registers 137 (57.6 % of design), M10Ks'
    );
    expect(headerTitle(oocReport, '/hier_0')).toBe(
      'Per block: LUTs 5 (0.6 % of design), FFs 6 (0.5 % of design), BRAM 2 (100.0 % of design), DSPs 0. Sum of the blocks inside, each built on its own'
    );
  });

  it('explains a block that is not in the report', () => {
    expect(headerTitle(quartusReport, '/clk_0')).toMatch(/^Not in the report/);
  });
});

describe('toolbarChip', () => {
  it('shows the stage, the design total and its share of the device', () => {
    expect(toolbarChip(resources(vivadoReport))).toBe('Post-route · 841 LUTs · 1.3 %');
  });

  it('writes a fraction for Quartus and a sum for the out-of-context stage', () => {
    expect(toolbarChip(resources(quartusReport))).toBe('Fitter · 114.1 ALMs · 0.4 %');
    // A sum of out-of-context runs is not placed on the device: no device share.
    expect(toolbarChip(resources(oocReport))).toBe('Per block · Σ 788 LUTs');
  });

  it('leaves out the device share without a capacity', () => {
    const report: ResourceReport = {
      ...vivadoReport,
      metrics: vivadoReport.metrics.map(({ capacity: _capacity, ...metric }) => metric),
    };
    expect(toolbarChip(resources(report))).toBe('Post-route · 841 LUTs');
  });

  it('says there is no report', () => {
    expect(toolbarChip(undefined)).toBe('No report');
    expect(toolbarChip(resources())).toBe('No report');
  });
});

describe('detailRows', () => {
  it('shows an em dash for a self figure the report does not give', () => {
    const rows = detailRows(quartusReport, '/ram_0');
    const m10k = rows.find((row) => row.label === 'M10Ks')!;
    expect(m10k).toMatchObject({ total: '8', self: '—' });
    expect(rows.find((row) => row.label === 'ALMs')).toMatchObject({ total: '0.3', self: '0.3' });
  });

  it('gives the share of the design and of the device', () => {
    const luts = detailRows(vivadoReport, '/axi_bram_ctrl_0').find((row) => row.label === 'LUTs');
    expect(luts?.ofDesign).toBe('18.3 %');
    expect(luts?.ofDevice).toBe('0.2 %');
  });

  it('shows an em dash for the device share of a metric with no capacity', () => {
    const row = detailRows(vivadoReport, '/axi_bram_ctrl_0').find(
      (item) => item.label === 'Logic LUTs'
    );
    expect(row?.ofDevice).toBe('—');
  });

  it('shows no device share for the sum of an out-of-context hierarchy, but for one of its IPs', () => {
    const hier = detailRows(oocReport, '/hier_0').find((row) => row.label === 'LUTs');
    expect(hier?.ofDevice).toBe('—');
    const ip = detailRows(oocReport, '/axi_gpio_0').find((row) => row.label === 'LUTs');
    expect(ip?.ofDevice).not.toBe('—');
  });

  it('is empty for a block with no usage', () => {
    expect(detailRows(quartusReport, '/clk_0')).toEqual([]);
  });
});

describe('formatChange', () => {
  it.each([
    [12, '+12'],
    [-3, '-3'],
    [0, '0'],
    [0.04, '0'],
    [-0.04, '0'],
    [1.5, '+1.5'],
    [-12345, '-12.3k'],
  ])('writes %p as %p', (difference, text) => {
    expect(formatChange(difference)).toBe(text);
  });
});

describe('detailRows with a compared report', () => {
  it('matches the compared totals by metric key and subtracts them', () => {
    const compared = {
      ...vivadoReport,
      metrics: [...vivadoReport.metrics].reverse(),
      instances: Object.fromEntries(
        Object.entries(vivadoReport.instances).map(([path, usage]) => [
          path,
          { total: [...usage.total].reverse().map((n) => n + 1) },
        ])
      ),
    };
    const rows = detailRows(vivadoReport, '/axi_bram_ctrl_0', compared);
    const plain = detailRows(vivadoReport, '/axi_bram_ctrl_0');
    expect(rows.map(({ compared: _c, change: _d, ...rest }) => rest)).toEqual(plain);
    expect(rows.map((row) => row.change)).toEqual(rows.map(() => '-1'));
    expect(plain.every((row) => row.compared === undefined && row.change === undefined)).toBe(true);
  });

  it('has no figure for a metric the compared report lacks', () => {
    const compared = { ...vivadoReport, metrics: vivadoReport.metrics.slice(1) };
    const [first] = detailRows(vivadoReport, '/axi_bram_ctrl_0', compared);
    expect(first).toMatchObject({ compared: '\u2014', change: '\u2014' });
  });
});
