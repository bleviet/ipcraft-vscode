import { planArrayCollapse, type CollapsibleInterface } from '../../../shared/arrayCollapse';
import { resolvePhysicalPortName, substitutePattern } from '../../../shared/physicalName';

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

  describe('zero-padded indices', () => {
    function stPadded(name: string, idxStr: string): CollapsibleInterface {
      return {
        name,
        type: ST,
        mode: 'sink',
        signalNames: {
          VALID: `asi_valid_${idxStr}_i`,
          DATA: `asi_data_${idxStr}_i`,
        },
      };
    }

    it('collapses two zero-padded siblings with a {index:2} width specifier', () => {
      const plan = planArrayCollapse([stPadded('sink_00_if', '00'), stPadded('sink_01_if', '01')]);
      expect(plan).toHaveLength(1);
      const p = plan[0];
      expect(p.kind).toBe('array');
      if (p.kind === 'array') {
        expect(p.physicalNamePattern).toBe('asi_{signal}_{index:2}_i');
        expect(p.namingPattern).toBe('sink_{index:2}_if');
        expect(p.indexStart).toBe(0);
        expect(p.count).toBe(2);
        // Regeneration reproduces the original zero-padded names exactly.
        expect(substitutePattern(p.physicalNamePattern, 'valid', 0)).toBe('asi_valid_00_i');
        expect(substitutePattern(p.physicalNamePattern, 'valid', 1)).toBe('asi_valid_01_i');
      }
    });

    it('collapses padded siblings across a digit-width boundary (00..10)', () => {
      // Without the width specifier this set was refused (lossless guard failed at index 10).
      const members = Array.from({ length: 11 }, (_, i) => {
        const s = String(i).padStart(2, '0');
        return stPadded(`sink_${s}_if`, s);
      });
      const plan = planArrayCollapse(members);
      expect(plan).toHaveLength(1);
      const p = plan[0];
      expect(p.kind).toBe('array');
      if (p.kind === 'array') {
        expect(p.physicalNamePattern).toBe('asi_{signal}_{index:2}_i');
        expect(p.count).toBe(11);
        // Round-trips both sides of the boundary.
        expect(substitutePattern(p.physicalNamePattern, 'valid', 0)).toBe('asi_valid_00_i');
        expect(substitutePattern(p.physicalNamePattern, 'valid', 9)).toBe('asi_valid_09_i');
        expect(substitutePattern(p.physicalNamePattern, 'valid', 10)).toBe('asi_valid_10_i');
      }
    });

    it('still emits bare {index} for non-padded indices', () => {
      const plan = planArrayCollapse([st('sink_0_if', 0), st('sink_1_if', 1)]);
      expect(plan[0]).toMatchObject({ physicalNamePattern: 'asi_{signal}_{index}_i' });
    });

    it('refuses to mix padded and non-padded widths in the same group', () => {
      // '00' (width 2) vs '1' (width 1) -> widths differ -> not a clean array.
      const plan = planArrayCollapse([stPadded('sink_00_if', '00'), st('sink_1_if', 1)]);
      expect(plan.every((p) => p.kind === 'single')).toBe(true);
    });
  });

  describe('logical signals with underscores', () => {
    it('round-trips a multi-token logical signal name via the string-based template', () => {
      // A custom interface whose logical signal contains an underscore (e.g. data_out).
      // The collapse operates on whole substrings, so the underscore is preserved.
      const mk = (name: string, i: number): CollapsibleInterface => ({
        name,
        type: 'ipcraft:busif:custom:1.0',
        mode: 'sink',
        signalNames: { DATA_OUT: `rx_data_out_${i}_i`, READY: `rx_ready_${i}_i` },
      });
      const plan = planArrayCollapse([mk('rx_0_if', 0), mk('rx_1_if', 1)]);
      const p = plan[0];
      expect(p.kind).toBe('array');
      if (p.kind === 'array') {
        expect(p.physicalNamePattern).toBe('rx_{signal}_{index}_i');
        // Regeneration reproduces the underscore-bearing physical names.
        expect(substitutePattern(p.physicalNamePattern, 'data_out', 0)).toBe('rx_data_out_0_i');
        expect(substitutePattern(p.physicalNamePattern, 'ready', 1)).toBe('rx_ready_1_i');
      }
    });
  });

  describe('mixed per-signal direction tags (_i/_o)', () => {
    // Avalon-ST sink: valid/data are inputs (carry `_i`), ready is an output (carries `_o`).
    // A single uniform template cannot express both; the collapse emits a `*` wildcard whose
    // per-signal substitution is captured in `wildcardMatches`.
    function stMixed(name: string, i: number): CollapsibleInterface {
      return {
        name,
        type: ST,
        mode: 'sink',
        signalNames: {
          VALID: `asi_valid_${i}_i`,
          DATA: `asi_data_${i}_i`,
          READY: `asi_ready_${i}_o`,
        },
      };
    }

    it('collapses into one array with a `*` wildcard + wildcardMatches', () => {
      const plan = planArrayCollapse([stMixed('sink_0_if', 0), stMixed('sink_1_if', 1)]);
      expect(plan).toHaveLength(1);
      const p = plan[0];
      expect(p.kind).toBe('array');
      if (p.kind === 'array') {
        expect(p.physicalNamePattern).toBe('asi_{signal}_{index}_*');
        expect(p.wildcardMatches).toEqual({ VALID: 'i', DATA: 'i', READY: 'o' });
        expect(p.count).toBe(2);
      }
    });

    it('regenerates every mixed-tag port name losslessly across both instances', () => {
      const plan = planArrayCollapse([stMixed('sink_0_if', 0), stMixed('sink_1_if', 1)]);
      const p = plan[0];
      expect(p.kind).toBe('array');
      if (p.kind !== 'array') {
        return;
      }
      const expected: Record<string, string> = {
        'VALID|0': 'asi_valid_0_i',
        'VALID|1': 'asi_valid_1_i',
        'DATA|0': 'asi_data_0_i',
        'DATA|1': 'asi_data_1_i',
        'READY|0': 'asi_ready_0_o',
        'READY|1': 'asi_ready_1_o',
      };
      for (const [key, want] of Object.entries(expected)) {
        const [logical, idxStr] = key.split('|');
        const got = resolvePhysicalPortName(
          logical,
          { physicalNamePattern: p.physicalNamePattern, wildcardMatches: p.wildcardMatches },
          Number(idxStr)
        );
        expect(got).toBe(want);
      }
    });

    it('combines zero-padding with the `*` wildcard (asi_valid_00_i / asi_ready_00_o)', () => {
      const mk = (i: number): CollapsibleInterface => {
        const s = String(i).padStart(2, '0');
        return {
          name: `sink_${s}_if`,
          type: ST,
          mode: 'sink',
          signalNames: {
            VALID: `asi_valid_${s}_i`,
            DATA: `asi_data_${s}_i`,
            READY: `asi_ready_${s}_o`,
          },
        };
      };
      const plan = planArrayCollapse([mk(0), mk(1)]);
      const p = plan[0];
      expect(p.kind).toBe('array');
      if (p.kind === 'array') {
        expect(p.physicalNamePattern).toBe('asi_{signal}_{index:2}_*');
        expect(p.wildcardMatches).toEqual({ VALID: 'i', DATA: 'i', READY: 'o' });
        expect(
          resolvePhysicalPortName(
            'READY',
            { physicalNamePattern: p.physicalNamePattern, wildcardMatches: p.wildcardMatches },
            1
          )
        ).toBe('asi_ready_01_o');
      }
    });

    it('refuses collapse when the decoration is not a trailing suffix', () => {
      // Disagreement before {signal}/{index} cannot be captured by a trailing `*`.
      const a: CollapsibleInterface = {
        name: 'sink_0_if',
        type: ST,
        mode: 'sink',
        signalNames: { VALID: 'asi_valid_0_i', DATA: 'aux_data_0_i' },
      };
      const b: CollapsibleInterface = {
        name: 'sink_1_if',
        type: ST,
        mode: 'sink',
        signalNames: { VALID: 'asi_valid_1_i', DATA: 'aux_data_1_i' },
      };
      const plan = planArrayCollapse([a, b]);
      expect(plan.every((p) => p.kind === 'single')).toBe(true);
    });
  });
});
