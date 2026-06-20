import { planArrayCollapse, type CollapsibleInterface } from '../../../shared/arrayCollapse';

const ST = 'ipcraft:busif:avalon_st:1.0';

function st(name: string, suffixIndex: number): CollapsibleInterface {
  return {
    name,
    type: ST,
    mode: 'sink',
    signalNames: {
      VALID: `asi_valid_${suffixIndex}_i`,
      DATA: `asi_data_${suffixIndex}_i`,
    },
  };
}

describe('planArrayCollapse', () => {
  it('collapses suffix-index siblings with a trailing direction tag', () => {
    const plan = planArrayCollapse([st('sink_0_if', 0), st('sink_1_if', 1)]);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toEqual({
      kind: 'array',
      indices: [0, 1],
      namingPattern: 'sink_{index}_if',
      physicalNamePattern: 'asi_{signal}_{index}_i',
      indexStart: 0,
      count: 2,
    });
  });

  it('collapses prefix-glued index (m_axis_ch0_*)', () => {
    const mk = (name: string, i: number): CollapsibleInterface => ({
      name,
      type: 'ipcraft:busif:axi_stream:1.0',
      mode: 'master',
      signalNames: { TDATA: `m_axis_ch${i}_tdata`, TVALID: `m_axis_ch${i}_tvalid` },
    });
    const plan = planArrayCollapse([mk('M_AXIS_CH0', 0), mk('M_AXIS_CH1', 1), mk('M_AXIS_CH2', 2)]);
    expect(plan).toHaveLength(1);
    const p = plan[0];
    expect(p.kind).toBe('array');
    if (p.kind === 'array') {
      expect(p.physicalNamePattern).toBe('m_axis_ch{index}_{signal}');
      expect(p.namingPattern).toBe('M_AXIS_CH{index}');
      expect(p.count).toBe(3);
      expect(p.indexStart).toBe(0);
    }
  });

  it('honours a non-zero indexStart', () => {
    const plan = planArrayCollapse([st('sink_1_if', 1), st('sink_2_if', 2)]);
    expect(plan[0]).toMatchObject({ kind: 'array', indexStart: 1, count: 2 });
  });

  it('does not collapse a single interface', () => {
    const plan = planArrayCollapse([st('sink_0_if', 0)]);
    expect(plan).toEqual([{ kind: 'single', index: 0 }]);
  });

  it('does not collapse when indices are non-contiguous', () => {
    const plan = planArrayCollapse([st('sink_0_if', 0), st('sink_2_if', 2)]);
    expect(plan).toEqual([
      { kind: 'single', index: 0 },
      { kind: 'single', index: 1 },
    ]);
  });

  it('does not collapse different types/modes', () => {
    const a = st('sink_0_if', 0);
    const b: CollapsibleInterface = { ...st('sink_1_if', 1), mode: 'source' };
    const plan = planArrayCollapse([a, b]);
    expect(plan).toEqual([
      { kind: 'single', index: 0 },
      { kind: 'single', index: 1 },
    ]);
  });

  it('does not collapse when port names do not vary by the same index as the names', () => {
    const a = st('sink_0_if', 0);
    const b = st('sink_1_if', 0); // name says 1 but ports still say 0 -> inconsistent
    const plan = planArrayCollapse([a, b]);
    expect(plan.every((p) => p.kind === 'single')).toBe(true);
  });

  it('keeps unrelated singles alongside a collapsed array, preserving order', () => {
    const lonely: CollapsibleInterface = {
      name: 'CTRL',
      type: 'ipcraft:busif:axi4_lite:1.0',
      mode: 'slave',
      signalNames: { AWVALID: 's_axi_awvalid' },
    };
    const plan = planArrayCollapse([lonely, st('sink_0_if', 0), st('sink_1_if', 1)]);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toEqual({ kind: 'single', index: 0 });
    expect(plan[1]).toMatchObject({ kind: 'array', indices: [1, 2] });
  });
});
