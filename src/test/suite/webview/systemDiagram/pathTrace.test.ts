import {
  computePathTrace,
  hopNetIds,
  hopSummary,
  traceEndpoints,
  traceNote,
  traceSubset,
} from '../../../../webview/systemDiagram/pathTrace';
import { boundaryId } from '../../../../webview/systemDiagram/model';
import { chainGraph } from './chainGraph';
import { loadFixtureGraph } from './fixtureGraph';

const graph = loadFixtureGraph();
const trace = (from: string, to: string) => computePathTrace(graph, '/', from, to);

describe('computePathTrace', () => {
  it('follows the signal direction over interface edges (tier 1)', () => {
    const found = trace('/processing_system7_0', '/axi_gpio_0');
    expect(found?.order).toEqual(['/processing_system7_0', '/ps7_0_axi_periph', '/axi_gpio_0']);
    expect(found?.tier).toBe(1);
    expect(found?.hops.map((hop) => [hop.from, hop.to])).toEqual([
      ['/processing_system7_0', '/ps7_0_axi_periph'],
      ['/ps7_0_axi_periph', '/axi_gpio_0'],
    ]);
  });

  it('needs interrupts and signals for tier 2', () => {
    const found = trace('/axi_dma_0', '/xlconcat_0');
    expect(found?.order).toEqual(['/axi_dma_0', '/xlconcat_0']);
    expect(found?.tier).toBe(2);
    const viaPort = trace(boundaryId('/', 'ext_trigger'), boundaryId('/', 'trigger_pulse'));
    expect(viaPort?.order).toEqual([
      boundaryId('/', 'ext_trigger'),
      '/pulse_gen_0',
      boundaryId('/', 'trigger_pulse'),
    ]);
    expect(viaPort?.tier).toBe(2);
  });

  it('ignores the direction when only a reversed path exists (tier 3)', () => {
    const found = trace('/axi_gpio_0', '/ps7_0_axi_periph');
    expect(found?.order).toEqual(['/axi_gpio_0', '/ps7_0_axi_periph']);
    expect(found?.tier).toBe(3);
  });

  it('ends on boundary ports of either direction', () => {
    const found = trace(boundaryId('/', 'leds_4bits'), '/processing_system7_0');
    expect(found?.order).toEqual([
      boundaryId('/', 'leds_4bits'),
      '/axi_gpio_0',
      '/ps7_0_axi_periph',
      '/processing_system7_0',
    ]);
    expect(found?.tier).toBe(3);
  });

  it('lists the edges of both directions between two blocks of a hop', () => {
    const found = trace('/axi_dma_0', '/dsp_pipeline');
    expect(found?.tier).toBe(1);
    expect(found?.hops).toHaveLength(1);
    const [hop] = found!.hops;
    expect(hop.edges.map((edge) => [edge.sourceNode, edge.targetNode]).sort()).toEqual([
      ['/axi_dma_0', '/dsp_pipeline'],
      ['/dsp_pipeline', '/axi_dma_0'],
    ]);
    expect(hopSummary(hop)).toBe('2 AXIS');
    expect(hopNetIds(hop)).toHaveLength(2);
  });

  it('returns nothing for the same block, a stranger or an unconnected pair', () => {
    expect(trace('/axi_dma_0', '/axi_dma_0')).toBeNull();
    expect(trace('/axi_dma_0', '/nope')).toBeNull();
    expect(trace('/pulse_gen_0', '/axi_dma_0')).toBeNull();
  });

  describe('on a small design', () => {
    it('takes the shortest path, and the same one every time', () => {
      const g = chainGraph(
        ['A', 'B', 'C', 'D', 'E'],
        [
          ['A', 'B', 'axis'],
          ['B', 'C', 'axis'],
          ['C', 'E', 'axis'],
          ['A', 'D', 'axis'],
          ['D', 'E', 'axis'],
          ['A', 'C', 'axis'],
        ]
      );
      // A -> C -> E and A -> D -> E tie at two hops; node id order picks C.
      expect(computePathTrace(g, '/', '/A', '/E')?.order).toEqual(['/A', '/C', '/E']);
      expect(computePathTrace(g, '/', '/A', '/E')?.order).toEqual(['/A', '/C', '/E']);
      expect(computePathTrace(g, '/', '/A', '/C')?.order).toEqual(['/A', '/C']);
    });

    it('prefers a longer directed interface path to a shorter one that needs a lower tier', () => {
      const g = chainGraph(
        ['A', 'B', 'C', 'D'],
        [
          ['A', 'D', 'signal'],
          ['A', 'B', 'axis'],
          ['B', 'C', 'axis'],
          ['C', 'D', 'axis'],
        ]
      );
      const found = computePathTrace(g, '/', '/A', '/D');
      expect(found?.order).toEqual(['/A', '/B', '/C', '/D']);
      expect(found?.tier).toBe(1);
    });

    it('is not carried by clock or reset edges', () => {
      const g = chainGraph(
        ['A', 'B', 'C'],
        [
          ['A', 'B', 'clock'],
          ['B', 'C', 'reset'],
        ]
      );
      expect(computePathTrace(g, '/', '/A', '/B')).toBeNull();
      expect(computePathTrace(g, '/', '/A', '/C')).toBeNull();
    });
  });
});

describe('traceSubset', () => {
  it('keeps the path blocks and every edge, of any category, between consecutive ones', () => {
    const found = trace('/processing_system7_0', '/axi_gpio_0')!;
    const { nodeIds, edgeIds, order } = traceSubset(graph, '/', found);
    expect([...nodeIds].sort()).toEqual([...found.order].sort());
    expect(order).toEqual(found.order);
    // Both hops carry an AXI wire; the PS also clocks the periph block.
    expect(edgeIds.size).toBeGreaterThan(2);
    expect([...edgeIds].some((id) => id.includes('FCLK_CLK0'))).toBe(true);
  });
});

describe('trace labels', () => {
  it('lists instances first, then ports, each sorted', () => {
    const labels = traceEndpoints(graph, '/').map((endpoint) => endpoint.label);
    const first = labels.indexOf('xlconcat_0');
    expect(labels.slice(0, first + 1)).toEqual([...labels.slice(0, first + 1)].sort());
    expect(labels.indexOf('DDR')).toBeGreaterThan(first);
  });

  it('notes the hop count and the direction rule', () => {
    expect(traceNote(trace('/processing_system7_0', '/axi_gpio_0')!)).toBe(
      '2 hops · follows signal direction'
    );
    expect(traceNote(trace('/axi_gpio_0', '/ps7_0_axi_periph')!)).toBe('1 hop · ignores direction');
  });
});
