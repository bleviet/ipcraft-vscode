import { parseQuartusEntities } from '../../../../services/resources/quartusEntityTable';
import {
  buildMetricLayout,
  readQuartusCapacity,
  readVivadoFlat,
  vivadoFlatMetrics,
} from '../../../../services/resources/resourceMetrics';
import { parseVivadoHierarchy } from '../../../../services/resources/vivadoHierarchyTable';
import { quartusFixture, vivadoFixture } from './fixtures';

describe('buildMetricLayout', () => {
  it('puts the Vivado primaries first and derives BRAM from RAMB36 and RAMB18', () => {
    const { columns, root } = parseVivadoHierarchy(vivadoFixture('routed_hier.rpt'));
    const layout = buildMetricLayout('vivado', 'routed', columns);
    expect(layout.metrics.map((m) => [m.key, m.label, m.primary])).toEqual([
      ['lut', 'LUTs', true],
      ['ff', 'FFs', true],
      ['bram', 'BRAM', true],
      ['dsp', 'DSPs', true],
      ['Logic LUTs', 'Logic LUTs', false],
      ['LUTRAMs', 'LUTRAMs', false],
      ['SRLs', 'SRLs', false],
    ]);
    expect(layout.project(root.total)).toEqual([841, 1386, 2, 0, 839, 0, 2]);
    expect(layout.project([0, 0, 0, 0, 0, 3, 5, 0])).toEqual([0, 0, 5.5, 0, 0, 0, 0]);
  });

  it('projects self figures, with null for a metric built from an unknown column', () => {
    const layout = buildMetricLayout('vivado', 'synth', ['Total LUTs', 'RAMB36', 'RAMB18']);
    expect(layout.projectSelf([4, 1, 3])).toEqual([4, 2.5]);
    expect(layout.projectSelf([null, 1, 3])).toEqual([null, 2.5]);
    expect(layout.projectSelf([4, null, 3])).toEqual([4, null]);
    expect(layout.projectSelf([4, 1, null])).toEqual([4, null]);
  });

  it('puts the Quartus fitter primaries first, with the memory column as written', () => {
    const { columns, root } = parseQuartusEntities(quartusFixture('spike.fit.rpt'));
    const layout = buildMetricLayout('quartus', 'fit', columns);
    expect(layout.metrics.slice(0, 4).map((m) => m.label)).toEqual([
      'ALMs',
      'Registers',
      'M10Ks',
      'DSP Blocks',
    ]);
    expect(layout.metrics.slice(0, 4).every((m) => m.primary)).toBe(true);
    expect(layout.metrics.slice(4).every((m) => !m.primary)).toBe(true);
    expect(layout.metrics.map((m) => m.label)).toContain('Combinational ALUTs');
    expect(layout.metrics.map((m) => m.label)).not.toContain('M10Ks (2)');
    const values = layout.project(root.total);
    expect(values[0]).toBeCloseTo(120.5);
    expect(values.slice(1, 4)).toEqual([246, 8, 0]);
  });

  it('puts the Quartus synthesis primaries first', () => {
    const { columns } = parseQuartusEntities(quartusFixture('spike.map.rpt'));
    const layout = buildMetricLayout('quartus', 'synth', columns);
    expect(layout.metrics.map((m) => [m.label, m.primary])).toEqual([
      ['ALUTs', true],
      ['Registers', true],
      ['Block Memory Bits', true],
      ['DSP Blocks', true],
      ['Pins', false],
      ['Virtual Pins', false],
    ]);
  });

  it('finds columns by text, not position', () => {
    const layout = buildMetricLayout('vivado', 'synth', [
      'DSP Blocks',
      'Extra',
      'FFs',
      'Total LUTs',
    ]);
    expect(layout.metrics.map((m) => m.key)).toEqual(['lut', 'ff', 'dsp', 'Extra']);
    expect(layout.project([1, 2, 3, 4])).toEqual([4, 3, 1, 2]);
  });

  it('attaches capacity by metric key', () => {
    const layout = buildMetricLayout('vivado', 'routed', ['Total LUTs', 'FFs'], { lut: 63400 });
    expect(layout.metrics.map((m) => m.capacity)).toEqual([63400, undefined]);
  });
});

describe('capacity', () => {
  it('reads Vivado capacity from a flat report', () => {
    expect(readVivadoFlat(vivadoFixture('routed_flat.rpt')).capacity).toEqual({
      lut: 63400,
      ff: 126800,
      bram: 135,
      dsp: 240,
    });
  });

  it('reads the used numbers of a flat report in metric order', () => {
    const { used } = readVivadoFlat(vivadoFixture('ooc/sys_bram_0_0_utilization_synth.rpt'));
    expect(vivadoFlatMetrics().map((m) => m.key)).toEqual(['lut', 'ff', 'bram', 'dsp']);
    expect(used).toEqual([5, 6, 2, 0]);
  });

  it('reads Quartus capacity from a .fit.summary; registers have none', () => {
    expect(readQuartusCapacity(quartusFixture('spike.fit.summary'))).toEqual({
      alm: 32070,
      ram: 397,
      dsp: 87,
    });
  });

  it('has no capacity when the text has none', () => {
    expect(readQuartusCapacity('')).toEqual({});
    expect(readVivadoFlat('').capacity).toEqual({});
  });
});
