import { isolationSubset } from '../../../../webview/systemDiagram/isolation';
import { levelEdges } from '../../../../webview/systemDiagram/layout/levelEdges';
import { boundaryId } from '../../../../webview/systemDiagram/model';
import { loadFixtureGraph } from './fixtureGraph';

const graph = loadFixtureGraph();
const sorted = (ids: ReadonlySet<string>) => [...ids].sort();

describe('isolationSubset', () => {
  it('keeps the other end of every edge of a selected block', () => {
    const { nodeIds, edgeIds } = isolationSubset(graph, '/', ['/axi_dma_0'], false);
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
    const { nodeIds, edgeIds } = isolationSubset(graph, '/', ['/axi_dma_0'], false);
    // dsp_pipeline -> axi_dma_0 is kept, axi_mem_intercon -> processing_system7_0 is not.
    expect(nodeIds.has('/processing_system7_0')).toBe(false);
    expect(edgeIds.has('/::axi_mem_intercon_M00_AXI#1')).toBe(false);
  });

  it('keeps boundary ports as selection and as neighbours', () => {
    const trigger = boundaryId('/', 'ext_trigger');
    const asSelection = isolationSubset(graph, '/', [trigger], false);
    expect(sorted(asSelection.nodeIds)).toEqual([trigger, '/pulse_gen_0'].sort());
    const asNeighbour = isolationSubset(graph, '/', ['/pulse_gen_0'], false);
    expect(asNeighbour.nodeIds.has(trigger)).toBe(true);
    expect(asNeighbour.nodeIds.has(boundaryId('/', 'trigger_pulse'))).toBe(true);
  });

  it('shows a selected block without edges alone', () => {
    const { nodeIds, edgeIds } = isolationSubset(graph, '/', ['/rst_ps7_0_100M'], false);
    expect([...nodeIds]).toEqual(['/rst_ps7_0_100M']);
    expect(edgeIds.size).toBe(0);
  });

  describe('clock and reset nets', () => {
    it('do not pull in neighbours while hidden', () => {
      const { nodeIds } = isolationSubset(graph, '/', ['/rst_ps7_0_100M'], false);
      expect(nodeIds.size).toBe(1);
    });

    it('pull in neighbours when shown', () => {
      const shown = isolationSubset(graph, '/', ['/rst_ps7_0_100M'], true);
      expect(shown.nodeIds.size).toBeGreaterThan(1);
      expect(shown.edgeIds.size).toBeGreaterThan(0);
    });

    it('keep only the edge to a selected sink of a fan-out net, all edges for its driver', () => {
      const clockEdges = levelEdges(graph, '/', true).filter((edge) =>
        edge.id.startsWith('/::processing_system7_0_FCLK_CLK0#')
      );
      expect(clockEdges.length).toBeGreaterThan(5);

      const bySink = isolationSubset(graph, '/', ['/axi_gpio_0'], true);
      const kept = clockEdges.filter((edge) => bySink.edgeIds.has(edge.id));
      expect(kept.map((edge) => edge.targetNode)).toEqual(['/axi_gpio_0']);
      expect(bySink.nodeIds.has('/processing_system7_0')).toBe(true);
      expect(bySink.nodeIds.has('/axi_dma_0')).toBe(false);

      const byDriver = isolationSubset(graph, '/', ['/processing_system7_0'], true);
      expect(clockEdges.every((edge) => byDriver.edgeIds.has(edge.id))).toBe(true);
      expect(byDriver.nodeIds.has('/axi_dma_0')).toBe(true);
    });
  });
});
