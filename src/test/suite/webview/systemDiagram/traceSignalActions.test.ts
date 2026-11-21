import { traceSignalActions } from '../../../../webview/systemDiagram/traceSignalActions';
import { loadFixtureGraph } from './fixtureGraph';

const graph = loadFixtureGraph();

function setup(design = graph) {
  const expandBlocks = jest.fn();
  const selectNet = jest.fn();
  return { actions: traceSignalActions(design, expandBlocks, selectNet), expandBlocks, selectNet };
}

describe('traceSignalActions', () => {
  it('expands the path and reveals the whole block when the wire climbs', () => {
    const { actions, expandBlocks, selectNet } = setup();
    actions.onTraceSignal('/dsp_pipeline::S_AXIS');
    expect(expandBlocks).toHaveBeenCalledWith(['/dsp_pipeline']);
    expect(selectNet).toHaveBeenCalledWith(
      '/::axi_dma_0_M_AXIS_MM2S',
      { nodeId: '/dsp_pipeline', pin: 'S_AXIS' },
      'whole'
    );
  });

  it('expands nothing and reveals readable when the wire stays on its level', () => {
    const edited = JSON.parse(JSON.stringify(graph)) as typeof graph;
    edited.nets = edited.nets.filter((net) => net.id !== '/::axi_dma_0_M_AXIS_MM2S');
    const { actions, expandBlocks, selectNet } = setup(edited);
    actions.onTraceSignal('/dsp_pipeline::S_AXIS');
    expect(expandBlocks).not.toHaveBeenCalled();
    expect(selectNet).toHaveBeenCalledWith(
      '/dsp_pipeline::Conn1',
      { nodeId: '/dsp_pipeline::S_AXIS', pin: 'S_AXIS' },
      'readable'
    );
  });

  it('does not trace a port on no net', () => {
    const edited = JSON.parse(JSON.stringify(graph)) as typeof graph;
    edited.nets = edited.nets.filter(
      (net) => net.id !== '/::axi_dma_0_M_AXIS_MM2S' && net.id !== '/dsp_pipeline::Conn1'
    );
    const { actions, expandBlocks, selectNet } = setup(edited);
    expect(actions.traceable('/dsp_pipeline::S_AXIS')).toBe(false);
    actions.onTraceSignal('/dsp_pipeline::S_AXIS');
    expect(expandBlocks).not.toHaveBeenCalled();
    expect(selectNet).not.toHaveBeenCalled();
  });
});
