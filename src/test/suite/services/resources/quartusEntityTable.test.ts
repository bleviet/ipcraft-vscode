import { parseQuartusEntities } from '../../../../services/resources/quartusEntityTable';
import type { ReportNode } from '../../../../services/resources/reportTree';
import { quartusFixture } from './fixtures';

const child = (node: ReportNode, name: string): ReportNode => {
  const found = node.children.find((c) => c.name === name);
  if (!found) {
    throw new Error(`no child ${name} of ${node.name}`);
  }
  return found;
};

describe('parseQuartusEntities', () => {
  const fit = parseQuartusEntities(quartusFixture('spike.fit.rpt'));
  const alm = fit.columns.indexOf('ALMs needed [=A-B+C]');

  it('excludes the name columns', () => {
    expect(fit.columns).toContain('ALMs needed [=A-B+C]');
    expect(fit.columns).toContain('M10Ks');
    for (const name of [
      'Compilation Hierarchy Node',
      'Full Hierarchy Name',
      'Entity Name',
      'Library Name',
    ]) {
      expect(fit.columns).not.toContain(name);
    }
  });

  it('reads total and self from "total (self)"', () => {
    expect(fit.root).toMatchObject({ name: 'top', module: 'top' });
    expect(fit.root.total[alm]).toBeCloseTo(120.5);
    expect(fit.root.self?.[alm]).toBeCloseTo(6.4);
  });

  it('splits entity:instance into module and name', () => {
    const u0 = child(fit.root, 'u0');
    expect(u0.module).toBe('sys');
    const pio = child(u0, 'pio_0');
    expect(pio).toMatchObject({ name: 'pio_0', module: 'sys_pio_0' });
    expect(pio.total[alm]).toBeCloseTo(4.8);
  });

  it('builds the tree from the Full Hierarchy Name', () => {
    const u0 = child(fit.root, 'u0');
    const rst = child(u0, 'rst_controller');
    expect(rst.children.map((c) => c.name)).toEqual(['alt_rst_req_sync_uq1', 'alt_rst_sync_uq1']);
    expect(u0.children.map((c) => c.name)).toEqual([
      'bridge_0',
      'rst_controller',
      'mm_interconnect_0',
      'pio_0',
      'pio_1',
      'ram_0',
    ]);
  });

  it('has no self figure (null) for a column with a single value', () => {
    const m10k = fit.columns.indexOf('M10Ks');
    const bits = fit.columns.indexOf('Block Memory Bits');
    const ram = child(child(fit.root, 'u0'), 'ram_0');
    expect(ram.total[m10k]).toBe(8);
    expect(ram.self?.[m10k]).toBeNull();
    expect(ram.self?.[bits]).toBeNull();
    expect(fit.root.self?.[m10k]).toBeNull();
    expect(fit.root.self?.[bits]).toBeNull();
    expect(fit.root.self?.[alm]).toBeCloseTo(6.4);
    expect(ram.self?.[alm]).toBeCloseTo(0.3);
  });

  it('reads the synthesis table with its own columns', () => {
    const map = parseQuartusEntities(quartusFixture('spike.map.rpt'));
    expect(map.columns).toEqual([
      'Combinational ALUTs',
      'Dedicated Logic Registers',
      'Block Memory Bits',
      'DSP Blocks',
      'Pins',
      'Virtual Pins',
    ]);
    expect(map.root.total[0]).toBe(150);
    expect(map.root.self?.[0]).toBe(16);
  });

  it('is empty when the text has no entity table', () => {
    expect(parseQuartusEntities('Fitter report for x')).toEqual({
      columns: [],
      root: { name: '', total: [], children: [] },
    });
  });
});
