import {
  matchPorts,
  inferGroupingPlan,
  inferPrefixAndMode,
} from '../../../webview/ipcore/utils/protocolMatcher';
import { BUS_VLNV } from '../../../shared/busVlnv';

const AVALON_ST = BUS_VLNV.AVALON_ST;

describe('protocolMatcher (tokenized)', () => {
  it('recognizes a single Avalon-ST sink with a trailing direction tag', () => {
    const ports = [
      { name: 'asi_valid_i', direction: 'in' as const },
      { name: 'asi_data_i', direction: 'in' as const },
    ];
    const plan = inferGroupingPlan(ports, AVALON_ST);
    expect(plan).not.toBeNull();
    expect(plan!.kind).toBe('single');
    if (plan!.kind === 'single') {
      // Decoration after {signal} -> pattern, not a plain prefix.
      expect(plan!.physicalNamePattern).toBe('asi_{signal}_i');
      expect(plan!.physicalPrefix).toBeUndefined();
      // Bus defs are master-perspective: a sink inputs valid/data -> slave.
      expect(plan!.mode).toBe('slave');
    }
  });

  it('collapses two indexed Avalon-ST sinks into an array interface', () => {
    const ports = [
      { name: 'asi_valid_0_i', direction: 'out' as const },
      { name: 'asi_data_0_i', direction: 'out' as const },
      { name: 'asi_valid_1_i', direction: 'out' as const },
      { name: 'asi_data_1_i', direction: 'out' as const },
    ];
    const plan = inferGroupingPlan(ports, AVALON_ST);
    expect(plan).not.toBeNull();
    expect(plan!.kind).toBe('array');
    if (plan!.kind === 'array') {
      expect(plan!.physicalNamePattern).toBe('asi_{signal}_{index}_i');
      expect(plan!.array.count).toBe(2);
      expect(plan!.array.indexStart).toBe(0);
      expect(plan!.matchedPortNames).toEqual(
        expect.arrayContaining(['asi_valid_0_i', 'asi_data_0_i', 'asi_valid_1_i', 'asi_data_1_i'])
      );
    }
  });

  it('keeps a plain prefix interface on the legacy prefix path (no decoration)', () => {
    const ports = [
      { name: 's_axi_awvalid', direction: 'out' as const },
      { name: 's_axi_awready', direction: 'in' as const },
      { name: 's_axi_wvalid', direction: 'out' as const },
      { name: 's_axi_wready', direction: 'in' as const },
    ];
    const plan = inferGroupingPlan(ports, BUS_VLNV.AXI4_LITE);
    expect(plan).not.toBeNull();
    expect(plan!.kind).toBe('single');
    if (plan!.kind === 'single') {
      expect(plan!.physicalPrefix).toBe('s_axi_');
      expect(plan!.physicalNamePattern).toBeUndefined();
    }
  });

  it('detects a glued index in the prefix (m_axis_ch0_data family)', () => {
    const ports = [
      { name: 'm_axis_ch0_tdata', direction: 'out' as const },
      { name: 'm_axis_ch0_tvalid', direction: 'out' as const },
      { name: 'm_axis_ch0_tready', direction: 'in' as const },
      { name: 'm_axis_ch1_tdata', direction: 'out' as const },
      { name: 'm_axis_ch1_tvalid', direction: 'out' as const },
      { name: 'm_axis_ch1_tready', direction: 'in' as const },
    ];
    const plan = inferGroupingPlan(ports, BUS_VLNV.AXI_STREAM);
    expect(plan).not.toBeNull();
    expect(plan!.kind).toBe('array');
    if (plan!.kind === 'array') {
      expect(plan!.physicalNamePattern).toBe('m_axis_ch{index}_{signal}');
      expect(plan!.array.count).toBe(2);
    }
  });

  it('does not collapse when the varying token is not a contiguous numeric index', () => {
    // Indices 0 and 2 -> non-contiguous -> the lossless guard refuses an array,
    // and the selection falls back to a single (representative) interface.
    const ports = [
      { name: 'asi_valid_0_i', direction: 'out' as const },
      { name: 'asi_data_0_i', direction: 'out' as const },
      { name: 'asi_valid_2_i', direction: 'out' as const },
      { name: 'asi_data_2_i', direction: 'out' as const },
    ];
    const plan = inferGroupingPlan(ports, AVALON_ST);
    expect(plan).not.toBeNull();
    // Either a single interface (representative) or no array merge — never a
    // two-member array with a gap.
    if (plan!.kind === 'array') {
      // If it does collapse, count must reflect actual members, never skip.
      expect(plan!.array.count).toBeLessThanOrEqual(1);
    }
  });

  it('matchPorts scores decorated/indexed selections above the threshold', () => {
    const ports = [
      { name: 'asi_valid_0_i', direction: 'out' as const },
      { name: 'asi_data_0_i', direction: 'out' as const },
      { name: 'asi_valid_1_i', direction: 'out' as const },
      { name: 'asi_data_1_i', direction: 'out' as const },
    ];
    const matches = matchPorts(ports);
    const avalon = matches.find((m) => m.busType === AVALON_ST);
    expect(avalon).toBeDefined();
    expect(avalon!.score).toBeGreaterThan(0);
  });

  it('returns null for an unrelated port set', () => {
    const ports = [
      { name: 'gpio_led', direction: 'out' as const },
      { name: 'gpio_btn', direction: 'in' as const },
    ];
    expect(inferGroupingPlan(ports, AVALON_ST)).toBeNull();
  });

  it('inferPrefixAndMode stays available for legacy callers', () => {
    // AXI4-Lite requires at least 4 required signals to clear minRequired.
    const ports = [
      { name: 's_axi_awvalid', direction: 'out' as const },
      { name: 's_axi_awready', direction: 'in' as const },
      { name: 's_axi_wvalid', direction: 'out' as const },
      { name: 's_axi_wready', direction: 'in' as const },
    ];
    const res = inferPrefixAndMode(ports, BUS_VLNV.AXI4_LITE);
    expect(res).not.toBeNull();
    expect(res!.prefix).toBe('s_axi_');
  });

  it('collapses a mixed _i/_o Avalon-ST sink into one wildcard array', () => {
    // valid/data are inputs (`_i`), ready is an output (`_o`). A single uniform template
    // cannot express both; the plan emits `asi_{signal}_{index}_*` with per-signal wildcards.
    const ports = [
      { name: 'asi_valid_0_i', direction: 'in' as const },
      { name: 'asi_data_0_i', direction: 'in' as const },
      { name: 'asi_ready_0_o', direction: 'out' as const },
      { name: 'asi_valid_1_i', direction: 'in' as const },
      { name: 'asi_data_1_i', direction: 'in' as const },
      { name: 'asi_ready_1_o', direction: 'out' as const },
    ];
    const plan = inferGroupingPlan(ports, AVALON_ST);
    expect(plan).not.toBeNull();
    expect(plan!.kind).toBe('array');
    if (plan!.kind === 'array') {
      expect(plan!.physicalNamePattern).toBe('asi_{signal}_{index}_*');
      // Avalon-ST signal names are lowercase in the bus catalog, so the wildcard keys match.
      expect(plan!.wildcardMatches).toEqual({ valid: 'i', data: 'i', ready: 'o' });
      expect(plan!.array.count).toBe(2);
      expect(plan!.matchedPortNames).toEqual(
        expect.arrayContaining([
          'asi_valid_0_i',
          'asi_data_0_i',
          'asi_ready_0_o',
          'asi_valid_1_i',
          'asi_data_1_i',
          'asi_ready_1_o',
        ])
      );
    }
  });
});
