import { parseVivadoHierarchy } from '../../../../services/resources/vivadoHierarchyTable';
import type { ReportNode } from '../../../../services/resources/reportTree';
import { vivadoFixture } from './fixtures';

const child = (node: ReportNode, name: string): ReportNode => {
  const found = node.children.find((c) => c.name === name);
  if (!found) {
    throw new Error(`no child ${name} of ${node.name}`);
  }
  return found;
};

describe('parseVivadoHierarchy', () => {
  const table = parseVivadoHierarchy(vivadoFixture('synth_hier.rpt'));
  const lut = table.columns.indexOf('Total LUTs');
  const ff = table.columns.indexOf('FFs');

  it('reads the numeric columns from the header, without Instance and Module', () => {
    expect(table.columns).toEqual([
      'Total LUTs',
      'Logic LUTs',
      'LUTRAMs',
      'SRLs',
      'FFs',
      'RAMB36',
      'RAMB18',
      'DSP Blocks',
    ]);
  });

  it('builds the tree from the indentation', () => {
    expect(table.root).toMatchObject({ name: 'sys_wrapper', module: '(top)' });
    expect(table.root.children.map((c) => c.name)).toEqual(['sys_i']);
    const sys = child(table.root, 'sys_i');
    expect(sys.module).toBe('sys');
    expect(sys.children.map((c) => c.name)).toEqual([
      'axi_bram_ctrl_0',
      'axi_gpio_0',
      'hier_0',
      'smartconnect_0',
    ]);
  });

  it('reads totals by column', () => {
    const gpio1 = child(child(child(table.root, 'sys_i'), 'hier_0'), 'axi_gpio_1');
    expect(gpio1.module).toBe('sys_axi_gpio_1_0');
    expect(gpio1.total[lut]).toBe(131);
    expect(gpio1.total[ff]).toBe(382);
    expect(table.root.total[lut]).toBe(919);
  });

  it('keeps a (name) row as the self row of its parent, not as a child', () => {
    const bram = child(child(table.root, 'sys_i'), 'axi_bram_ctrl_0');
    expect(bram.children.map((c) => c.name)).toEqual(['U0']);
    expect(bram.self).toEqual(new Array(table.columns.length).fill(0));
    expect(table.root.children.some((c) => c.name.startsWith('('))).toBe(false);
  });

  it('is empty when the text has no hierarchy table', () => {
    expect(parseVivadoHierarchy('nothing here')).toEqual({
      columns: [],
      root: { name: '', total: [], children: [] },
    });
  });

  it('reads numbers with commas', () => {
    const text = [
      '| Instance | Module | Total LUTs |',
      '| top | (top) | 1,234 |',
      '|   a | m | 1,000 |',
    ].join('\n');
    const parsed = parseVivadoHierarchy(text);
    expect(parsed.root.total).toEqual([1234]);
    expect(parsed.root.children[0].total).toEqual([1000]);
  });
});

describe('parseVivadoHierarchy on an UltraScale+ report', () => {
  const table = parseVivadoHierarchy(vivadoFixture('zynqup_hier.rpt', 'ultrascale'));
  const lut = table.columns.indexOf('Total LUTs');
  const ff = table.columns.indexOf('FFs');

  it('reads the URAM column between RAMB18 and DSP Blocks', () => {
    expect(table.columns).toEqual([
      'Total LUTs',
      'Logic LUTs',
      'LUTRAMs',
      'SRLs',
      'FFs',
      'RAMB36',
      'RAMB18',
      'URAM',
      'DSP Blocks',
    ]);
  });

  it('maps the blocks u_avmm, u_regs and u_core with their LUT and FF counts', () => {
    expect(table.root).toMatchObject({ name: 'led_controller_avmm', module: '(top)' });
    expect(table.root.total[lut]).toBe(8);
    expect(table.root.total[ff]).toBe(45);
    expect(table.root.children.map((c) => c.name)).toEqual(['u_avmm', 'u_core']);
    const avmm = child(table.root, 'u_avmm');
    const regs = child(avmm, 'u_regs');
    const core = child(table.root, 'u_core');
    expect([avmm.total[lut], avmm.total[ff]]).toEqual([7, 19]);
    expect([regs.total[lut], regs.total[ff]]).toEqual([7, 19]);
    expect([core.total[lut], core.total[ff]]).toEqual([1, 26]);
  });
});
