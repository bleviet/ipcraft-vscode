import { renderHook, act } from '@testing-library/react';
import { useIsolation } from '../../../../webview/systemDiagram/hooks/useIsolation';
import type { NetCategory, SystemGraph, SystemPin } from '../../../../domain/systemGraph';
import {
  hopDistances,
  isolationSubset,
  maxHops,
} from '../../../../webview/systemDiagram/isolation';
import { levelEdges } from '../../../../webview/systemDiagram/layout/levelEdges';
import { boundaryId } from '../../../../webview/systemDiagram/model';
import { loadFixtureGraph } from './fixtureGraph';

const graph = loadFixtureGraph();
const sorted = (ids: ReadonlySet<string>) => [...ids].sort();

describe('isolationSubset', () => {
  it('keeps the other end of every edge of a selected block', () => {
    const { nodeIds, edgeIds } = isolationSubset(graph, '/', ['/axi_dma_0']);
    expect(sorted(nodeIds)).toEqual(
      [
        '/axi_dma_0',
        '/dsp_pipeline',
        '/axi_mem_intercon',
        '/ps7_0_axi_periph',
        '/xlconcat_0',
      ].sort()
    );
    expect(edgeIds.size).toBe(7);
  });

  it('hides edges between two neighbours', () => {
    const { nodeIds, edgeIds } = isolationSubset(graph, '/', ['/axi_dma_0']);
    // dsp_pipeline -> axi_dma_0 is kept, axi_mem_intercon -> processing_system7_0 is not.
    expect(nodeIds.has('/processing_system7_0')).toBe(false);
    expect(edgeIds.has('/::axi_mem_intercon_M00_AXI#1')).toBe(false);
  });

  it('keeps boundary ports as selection and as neighbours', () => {
    const trigger = boundaryId('/', 'ext_trigger');
    const asSelection = isolationSubset(graph, '/', [trigger]);
    expect(sorted(asSelection.nodeIds)).toEqual([trigger, '/pulse_gen_0'].sort());
    const asNeighbour = isolationSubset(graph, '/', ['/pulse_gen_0']);
    expect(asNeighbour.nodeIds.has(trigger)).toBe(true);
    expect(asNeighbour.nodeIds.has(boundaryId('/', 'trigger_pulse'))).toBe(true);
  });

  it('shows a selected block wired only by clocks and resets alone', () => {
    const rst = '/rst_ps7_0_100M';
    const touching = levelEdges(graph, '/').filter(
      (edge) => edge.sourceNode === rst || edge.targetNode === rst
    );
    expect(touching.length).toBeGreaterThan(0);
    const { nodeIds, edgeIds } = isolationSubset(graph, '/', [rst]);
    expect([...nodeIds]).toEqual([rst]);
    expect(edgeIds.size).toBe(0);
  });

  describe('clock and reset nets', () => {
    const CLOCK = '/::processing_system7_0_FCLK_CLK0#';
    const clockEdges = levelEdges(graph, '/').filter((edge) => edge.id.startsWith(CLOCK));

    it('are kept only as wires between a selected block and a kept one', () => {
      expect(clockEdges.length).toBeGreaterThan(5);

      const byDriver = isolationSubset(graph, '/', ['/processing_system7_0']);
      const kept = clockEdges.filter((edge) => byDriver.edgeIds.has(edge.id));
      expect(kept.map((edge) => edge.targetNode).sort()).toEqual(
        [
          '/axi_mem_intercon',
          '/processing_system7_0',
          '/processing_system7_0',
          '/ps7_0_axi_periph',
        ].sort()
      );
      // The blocks the clock reaches that were not kept for a data wire stay out.
      expect(byDriver.nodeIds.has('/axi_dma_0')).toBe(false);
      expect(byDriver.nodeIds.has('/axi_gpio_0')).toBe(false);

      const bySink = isolationSubset(graph, '/', ['/ps7_0_axi_periph']);
      expect(clockEdges.filter((edge) => bySink.edgeIds.has(edge.id))).toHaveLength(1);
      expect(bySink.nodeIds.has('/processing_system7_0')).toBe(true);
    });

    it('draw no wire between two blocks when neither is selected', () => {
      const { nodeIds, edgeIds } = isolationSubset(graph, '/', ['/ps7_0_axi_periph']);
      expect(nodeIds.has('/axi_dma_0') && nodeIds.has('/axi_gpio_0')).toBe(true);
      expect(
        clockEdges.some(
          (edge) =>
            edgeIds.has(edge.id) &&
            edge.sourceNode !== '/ps7_0_axi_periph' &&
            edge.targetNode !== '/ps7_0_axi_periph'
        )
      ).toBe(false);
    });
  });
});

/** Instances `/a`.. with pins `o` (out), `i` (in), `clk`; `wires` are `[from, to, category?]` nets on the root level. */
function wiredGraph(names: string[], wires: Array<[string, string, NetCategory?]>): SystemGraph {
  const pin = (name: string, direction: 'in' | 'out'): SystemPin => ({
    name,
    isInterface: false,
    direction,
    directionSource: 'declared',
    parameters: {},
  });
  const instances: SystemGraph['instances'] = {};
  for (const name of names) {
    instances[`/${name}`] = {
      path: `/${name}`,
      name,
      parent: '/',
      kind: 'ip',
      parameters: {},
      pins: [pin('o', 'out'), pin('i', 'in'), pin('clk', 'out'), pin('clk_in', 'in')],
      line: 1,
    };
  }
  return {
    name: 'wired',
    source: { fileName: 'wired.tcl', format: 'vivado-bd-tcl' },
    levels: {
      '/': { path: '/', name: 'wired', boundaryPins: [], instances: names.map((n) => `/${n}`) },
    },
    instances,
    nets: wires.map(([from, to, category = 'signal'], index) => {
      const clocked = category === 'clock';
      return {
        id: `/::n${index}`,
        name: `n${index}`,
        level: '/',
        isInterface: false,
        category,
        categorySource: 'declared',
        endpoints: [
          { instance: `/${from}`, pin: clocked ? 'clk' : 'o' },
          { instance: `/${to}`, pin: clocked ? 'clk_in' : 'i' },
        ],
        line: 1,
      };
    }),
    addressSegments: [],
    capabilities: {
      hierarchy: 'complete',
      connections: 'complete',
      addressMap: 'complete',
      userParameters: 'complete',
      propagatedParameters: 'complete',
      unconnectedPins: 'complete',
    },
    diagnostics: [],
  };
}

describe('hop isolation', () => {
  const chain = wiredGraph(
    ['a', 'b', 'c', 'd', 'e'],
    [
      ['a', 'b'],
      ['b', 'c'],
      ['d', 'c'],
      ['d', 'e'],
    ]
  );
  const edgeOf = (net: number) => `/::n${net}#1`;

  it('measures hop distances in either direction on a chain', () => {
    const distances = hopDistances(chain, '/', ['/a']);
    expect([...distances]).toEqual([
      ['/a', 0],
      ['/b', 1],
      ['/c', 2],
      ['/d', 3],
      ['/e', 4],
    ]);
    expect(maxHops(distances)).toBe(4);
    expect(maxHops(hopDistances(chain, '/', ['/c']))).toBe(2);
  });

  it('grows the chain one block per hop and hides the outermost-ring wire', () => {
    const at = (hops: number) => isolationSubset(chain, '/', ['/a'], hops);
    expect(sorted(at(1).nodeIds)).toEqual(['/a', '/b']);
    expect(sorted(at(1).edgeIds)).toEqual([edgeOf(0)]);
    expect(sorted(at(2).nodeIds)).toEqual(['/a', '/b', '/c']);
    expect(sorted(at(2).edgeIds)).toEqual([edgeOf(0), edgeOf(1)]);
    expect(sorted(at(3).nodeIds)).toEqual(['/a', '/b', '/c', '/d']);
    expect(sorted(at(3).edgeIds)).toEqual([edgeOf(0), edgeOf(1), edgeOf(2)]);
    expect(sorted(at(4).nodeIds)).toHaveLength(5);
    expect(sorted(at(4).edgeIds)).toHaveLength(4);
  });

  it('matches the default of one hop', () => {
    expect(isolationSubset(chain, '/', ['/b'])).toEqual(isolationSubset(chain, '/', ['/b'], 1));
  });

  it('hides a wire between two blocks of the outermost ring until the end point', () => {
    const triangle = wiredGraph(
      ['r', 'x', 'y', 'z'],
      [
        ['r', 'x'],
        ['x', 'y'],
        ['y', 'z'],
        ['r', 'y'],
      ]
    );
    // From r: x and y at 1, z at 2. At 1 hop the x-y wire joins two outermost blocks.
    const one = isolationSubset(triangle, '/', ['/r'], 1);
    expect(sorted(one.nodeIds)).toEqual(['/r', '/x', '/y']);
    expect(sorted(one.edgeIds)).toEqual([edgeOf(0), edgeOf(3)]);
    expect(maxHops(hopDistances(triangle, '/', ['/r']))).toBe(2);
    // At the end point every wire between the connected blocks shows.
    expect(sorted(isolationSubset(triangle, '/', ['/r'], 2).edgeIds)).toEqual(
      [edgeOf(0), edgeOf(1), edgeOf(2), edgeOf(3)].sort()
    );
  });

  it('shows the wire between two outermost blocks when one hop reaches everything', () => {
    const tri = wiredGraph(
      ['r', 'x', 'y'],
      [
        ['r', 'x'],
        ['r', 'y'],
        ['x', 'y'],
      ]
    );
    expect(isolationSubset(tri, '/', ['/r'], 1).edgeIds.size).toBe(3);
  });

  it('spreads a tree by level from several selected blocks', () => {
    const tree = wiredGraph(
      ['root', 'l', 'r', 'll', 'lr', 'rl'],
      [
        ['root', 'l'],
        ['root', 'r'],
        ['l', 'll'],
        ['l', 'lr'],
        ['r', 'rl'],
      ]
    );
    expect(hopDistances(tree, '/', ['/l', '/r']).get('/rl')).toBe(1);
    expect(sorted(isolationSubset(tree, '/', ['/root'], 2).nodeIds)).toEqual(
      ['/root', '/l', '/r', '/ll', '/lr', '/rl'].sort()
    );
    expect(sorted(isolationSubset(tree, '/', ['/l'], 2).nodeIds)).toEqual(
      ['/l', '/root', '/ll', '/lr', '/r'].sort()
    );
  });

  it('keeps a disconnected node at distance 0 and out of reach', () => {
    const graph = wiredGraph(['a', 'b', 'z'], [['a', 'b']]);
    expect([...hopDistances(graph, '/', ['/z'])]).toEqual([['/z', 0]]);
    expect(maxHops(hopDistances(graph, '/', ['/z']))).toBe(0);
    expect(sorted(isolationSubset(graph, '/', ['/a', '/z'], 3).nodeIds)).toEqual([
      '/a',
      '/b',
      '/z',
    ]);
  });

  it('never lets a clock or reset net add a node at any radius', () => {
    const graph = wiredGraph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['a', 'c', 'clock'],
        ['b', 'c', 'reset'],
      ]
    );
    expect(hopDistances(graph, '/', ['/a']).has('/c')).toBe(false);
    for (const hops of [1, 2, 3]) {
      expect(isolationSubset(graph, '/', ['/a'], hops).nodeIds.has('/c')).toBe(false);
    }
  });
});

describe('useIsolation radius', () => {
  const nav = {
    levelPath: '/',
    expanded: new Set<string>(),
    selectAndReveal: jest.fn(),
    revealMatch: jest.fn(),
    selectInstance: jest.fn(),
  };
  const long = wiredGraph(
    ['a', 'b', 'c', 'd', 'e', 'f'],
    [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
      ['e', 'f'],
    ]
  );
  const short = wiredGraph(
    ['a', 'b', 'c', 'd', 'e', 'f'],
    [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
    ]
  );

  it('clamps the radius to the new reach when the graph shrinks, then steps one ring', () => {
    const { result, rerender } = renderHook(({ graph }) => useIsolation(graph, nav), {
      initialProps: { graph: long },
    });
    act(() => result.current.isolate(['/a']));
    for (let i = 0; i < 4; i += 1) {
      act(() => result.current.setHops(result.current.isolation!.hops + 1));
    }
    expect(result.current.isolation).toMatchObject({ hops: 5, maxRadius: 5 });
    rerender({ graph: short });
    expect(result.current.isolation).toMatchObject({ hops: 3, maxRadius: 3 });
    expect(result.current.isolation!.nodeIds.size).toBe(4);
    const token = result.current.isolation!.token;
    act(() => result.current.setHops(result.current.isolation!.hops + 1));
    expect(result.current.isolation!.token).toBe(token);
    act(() => result.current.setHops(result.current.isolation!.hops - 1));
    expect(result.current.isolation).toMatchObject({ hops: 2 });
    expect(result.current.isolation!.nodeIds.size).toBe(3);
  });
});
