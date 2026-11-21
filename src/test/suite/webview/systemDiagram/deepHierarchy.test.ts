import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { isBoundaryPinRow, netTreeRows } from '../../../../webview/systemDiagram/clocks/netTree';
import { buildElkInput } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { traceSignal } from '../../../../webview/systemDiagram/traceSignal';
import { fakeMeasure, loadDeepGraph } from './fixtureGraph';

const graph = loadDeepGraph(2);
const lane = (r: number, c: number, l: number) => `/region${r}/cluster${c}/lane${l}`;
const stage = (path: string) => `${path}/stage`;
const core = (path: string) => `${path}/stage/core`;
const FIRST = lane(0, 0, 0);
const LAST = lane(1, 3, 3);
/** The hierarchy blocks from `/region<r>` down to the core of the lane `path`. */
const fromRegion = (path: string) => [
  path.split('/').slice(0, 2).join('/'),
  path.split('/').slice(0, 3).join('/'),
  path,
  stage(path),
  core(path),
];

const hierCount = (g: typeof graph) =>
  Object.values(g.instances).filter((instance) => instance.kind === 'hier').length;

describe('the deep SoC fixture', () => {
  it('has five levels below the root and no problems reading it', () => {
    const depth = Math.max(...Object.keys(graph.levels).map((p) => p.split('/').length - 1));
    expect(depth).toBe(5);
    // 2 regions, 8 clusters, 32 lanes, 32 stages, 32 cores.
    expect(hierCount(graph)).toBe(106);
    expect(Object.keys(graph.levels)).toHaveLength(107);
    expect(Object.values(graph.instances).some((i) => i.kind === 'blackbox')).toBe(false);
    expect(graph.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('reads the 8-region design too', () => {
    const big = loadDeepGraph(8);
    expect(hierCount(big)).toBe(424);
    expect(Object.values(big.instances).some((i) => i.kind === 'blackbox')).toBe(false);
    expect(big.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  }, 60000);

  it('has one probe_tap, in the core of the last lane', () => {
    const taps = Object.keys(graph.instances).filter((p) => p.endsWith('/probe_tap'));
    expect(taps).toEqual([`${core(LAST)}/probe_tap`]);
  });
});

describe('traceSignal on the deep SoC', () => {
  it('a: follows a stream through every level to the root port', () => {
    expect(traceSignal(graph, core(FIRST), 's_axis_in')).toEqual({
      netId: '/::rx0_1',
      focus: { nodeId: '/region0', pin: 'rx_c0_l0' },
      expand: fromRegion(FIRST),
    });
    expect(traceSignal(graph, core(LAST), 's_axis_in')).toEqual({
      netId: '/::rx31_1',
      focus: { nodeId: '/region1', pin: 'rx_c3_l3' },
      expand: fromRegion(LAST),
    });
  });

  it('b: reaches the root clock through either pin of the region', () => {
    expect(traceSignal(graph, lane(0, 0, 0), 'mon_clk')).toEqual({
      netId: '/::clk_wiz_0_clk_out1',
      focus: { nodeId: '/region0', pin: 'clk_aux' },
      expand: ['/region0', '/region0/cluster0', FIRST],
    });
    expect(traceSignal(graph, lane(0, 0, 0), 'aclk')).toEqual({
      netId: '/::clk_wiz_0_clk_out1',
      focus: { nodeId: '/region0', pin: 'clk' },
      expand: ['/region0', '/region0/cluster0', FIRST],
    });
  });

  it('c: stops in a daisy chain between lanes, and reaches the root at its start', () => {
    expect(traceSignal(graph, lane(0, 0, 1), 'dbg_in')).toEqual({
      netId: '/region0/cluster0::dbg_1',
      focus: { nodeId: lane(0, 0, 1), pin: 'dbg_in' },
      expand: [lane(0, 0, 1)],
    });
    expect(traceSignal(graph, lane(0, 0, 0), 'dbg_in')).toEqual({
      netId: '/::dbg_0',
      focus: { nodeId: '/region0', pin: 'dbg_in' },
      expand: ['/region0', '/region0/cluster0', FIRST],
    });
  });

  it('d: stops on the lane net of a wire that comes from a lane cell', () => {
    expect(traceSignal(graph, core(FIRST), 'cfg')).toEqual({
      netId: `${FIRST}::lane_cfg_out`,
      focus: { nodeId: stage(FIRST), pin: 'cfg' },
      expand: [stage(FIRST), core(FIRST)],
    });
  });

  it('e: takes the boundary pin that leads up, not the one listed first', () => {
    expect(traceSignal(graph, core(FIRST), 'status')).toEqual({
      netId: `${FIRST}::stage_status`,
      focus: { nodeId: stage(FIRST), pin: 'status' },
      expand: [stage(FIRST), core(FIRST)],
    });
    expect(traceSignal(graph, stage(FIRST), 'status_mon')).toEqual({
      netId: `${stage(FIRST)}::core_status`,
      focus: { nodeId: `${stage(FIRST)}::status_mon`, pin: 'status_mon' },
      expand: [],
    });
  });

  it('f: has nothing to trace for a port on no net', () => {
    expect(traceSignal(graph, core(FIRST), 'spare')).toBeUndefined();
  });
});

describe('the connection tree of a port on the deep SoC', () => {
  it('has a net on each of the six levels and marks the port once', () => {
    const level = core(FIRST);
    const physical = analyzeClocks(graph).physicalOfPin(level, {
      instance: null,
      pin: 's_axis_in',
    })!;
    expect(physical.nets.map((n) => n.level).sort()).toEqual(
      ['/', '/region0', '/region0/cluster0', FIRST, stage(FIRST), level].sort()
    );
    const { driver, driverNet } = physical;
    const rows = netTreeRows(
      graph,
      driverNet!.id,
      driver && { instance: driver.instance, pin: driver.pin }
    );
    const depths = new Set(rows.filter((row) => row.kind === 'net').map((row) => row.depth));
    expect([...depths].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    const here = rows.filter(
      (row) => row.kind === 'pin' && isBoundaryPinRow(row, level, 's_axis_in')
    );
    expect(here).toHaveLength(1);
  });
});

describe('laying out the deep SoC', () => {
  it.each(['/', core(FIRST)])(
    'lays out level %s',
    async (level) => {
      const layout = await runElkLayout(buildElkInput(graph, level, { measure: fakeMeasure }));
      const { instances, boundaryPins } = graph.levels[level];
      expect(layout.children).toHaveLength(instances.length + boundaryPins.length);
    },
    60000
  );
});
