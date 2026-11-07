import { isolationSubset } from '../../../../webview/systemDiagram/isolation';
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
