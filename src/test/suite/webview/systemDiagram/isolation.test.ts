import { isolationSubset, pairSubset } from '../../../../webview/systemDiagram/isolation';
import { levelEdges } from '../../../../webview/systemDiagram/layout/levelEdges';
import { boundaryId } from '../../../../webview/systemDiagram/model';
import { chainGraph } from './chainGraph';
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

describe('isolationSubset with two hops', () => {
  const chain = chainGraph(
    ['S', 'A', 'B', 'C', 'D', 'X', 'Y'],
    [
      ['S', 'A', 'axis'],
      ['A', 'B', 'axis'],
      ['A', 'C', 'axis'],
      ['B', 'C', 'axis'],
      ['B', 'D', 'axis'],
      ['A', 'X', 'clock'],
      ['X', 'Y', 'axis'],
      ['S', 'Y', 'reset'],
      ['S', 'B', 'clock'],
    ]
  );

  it('shows the blocks within two data edges of the selection', () => {
    const { nodeIds } = isolationSubset(chain, '/', ['/S'], 2);
    expect(sorted(nodeIds)).toEqual(['/A', '/B', '/C', '/S']);
  });

  it('keeps the one-hop result by default', () => {
    expect(sorted(isolationSubset(chain, '/', ['/S']).nodeIds)).toEqual(['/A', '/S']);
    expect(sorted(isolationSubset(chain, '/', ['/S'], 1).nodeIds)).toEqual(['/A', '/S']);
  });

  it('hides the edge between two blocks of the second ring', () => {
    const { edgeIds } = isolationSubset(chain, '/', ['/S'], 2);
    const between = (a: string, b: string) =>
      levelEdges(chain, '/')
        .filter((edge) => edge.sourceNode === a && edge.targetNode === b)
        .map((edge) => edge.id);
    expect(between('/B', '/C').some((id) => edgeIds.has(id))).toBe(false);
    expect(between('/A', '/B').every((id) => edgeIds.has(id))).toBe(true);
    expect(between('/A', '/C').every((id) => edgeIds.has(id))).toBe(true);
  });

  it('never pulls a block in over a clock or reset edge, but draws the wire between kept blocks', () => {
    const { nodeIds, edgeIds } = isolationSubset(chain, '/', ['/A'], 2);
    // X hangs on A by a clock only, and Y on S by a reset only.
    expect(nodeIds.has('/X')).toBe(false);
    expect(nodeIds.has('/Y')).toBe(false);
    expect(sorted(nodeIds)).toEqual(['/A', '/B', '/C', '/D', '/S']);
    const reset = levelEdges(chain, '/').find((edge) => edge.category === 'reset');
    expect(reset && edgeIds.has(reset.id)).toBe(false);
    const withS = isolationSubset(chain, '/', ['/S', '/A'], 2);
    expect(withS.nodeIds.has('/Y')).toBe(false);
  });

  it('keeps a clock wire between a selected block and a kept one at two hops', () => {
    const clock = levelEdges(chain, '/').find(
      (edge) => edge.category === 'clock' && edge.sourceNode === '/S' && edge.targetNode === '/B'
    )!;
    const { nodeIds, edgeIds } = isolationSubset(chain, '/', ['/S'], 2);
    // B is kept for its data wires; the clock wire to it is drawn, and Y still stays out.
    expect(nodeIds.has('/B')).toBe(true);
    expect(edgeIds.has(clock.id)).toBe(true);
    expect(nodeIds.has('/Y')).toBe(false);
    // A clock wire alone brings B in at no hop count.
    const alone = chainGraph(['S', 'B'], [['S', 'B', 'clock']]);
    expect(isolationSubset(alone, '/', ['/S'], 2).nodeIds.has('/B')).toBe(false);
  });

  it('is a superset of one hop on the fixture', () => {
    const one = isolationSubset(graph, '/', ['/axi_gpio_0']);
    const two = isolationSubset(graph, '/', ['/axi_gpio_0'], 2);
    expect([...one.nodeIds].every((id) => two.nodeIds.has(id))).toBe(true);
    expect([...one.edgeIds].every((id) => two.edgeIds.has(id))).toBe(true);
    expect(two.nodeIds.has('/processing_system7_0')).toBe(true);
    expect(two.nodeIds.has('/axi_dma_0')).toBe(true);
  });
});

describe('pairSubset', () => {
  const edges = levelEdges(graph, '/');
  const between = (a: string, b: string) =>
    edges.filter(
      (edge) =>
        (edge.sourceNode === a && edge.targetNode === b) ||
        (edge.sourceNode === b && edge.targetNode === a)
    );

  it('keeps exactly the two nodes and the edges between them in both directions', () => {
    const a = '/axi_dma_0';
    const b = '/dsp_pipeline';
    const { nodeIds, edgeIds } = pairSubset(graph, '/', a, b);
    expect(sorted(nodeIds)).toEqual([a, b].sort());
    expect(between(a, b).length).toBeGreaterThan(0);
    expect(sorted(edgeIds)).toEqual(
      between(a, b)
        .map((edge) => edge.id)
        .sort()
    );
    expect(pairSubset(graph, '/', b, a).edgeIds).toEqual(edgeIds);
  });

  it('keeps clock edges between the pair too, and no edge to a third node', () => {
    const ps = '/processing_system7_0';
    const dma = '/axi_dma_0';
    const { edgeIds } = pairSubset(graph, '/', ps, dma);
    const categories = between(ps, dma).map((edge) => edge.category);
    expect(categories).toContain('clock');
    expect(edgeIds.size).toBe(categories.length);
  });
});
