import type { NetCategory } from '../../../../domain/systemGraph';
import type { LevelEdge } from '../../../../webview/systemDiagram/layout/levelEdges';
import { placementEdges } from '../../../../webview/systemDiagram/layout/placementEdges';

function edge(
  id: string,
  category: NetCategory,
  sourceNode: string,
  targetNode: string
): LevelEdge {
  return { id, category, sourceNode, sourcePin: 'o', targetNode, targetPin: 'i' };
}

describe('placementEdges', () => {
  const data = edge('/::m#1', 'aximm', '/ps', '/smc');
  const stream = edge('/::s#1', 'axis', '/smc', '/dma');

  it('keeps every data and interface edge', () => {
    const signal = edge('/::g#1', 'signal', '/dma', '/::led');
    const irq = edge('/::q#1', 'interrupt', '/dma', '/ps');
    expect(placementEdges([data, stream, signal, irq])).toEqual([data, stream, signal, irq]);
  });

  it('drops a clock or reset edge into a block that has a data edge', () => {
    const clock = edge('/::clk#1', 'clock', '/ps', '/smc');
    const reset = edge('/::rst#1', 'reset', '/ps', '/dma');
    expect(placementEdges([data, clock, stream, reset])).toEqual([data, stream]);
  });

  it('keeps a clock or reset edge into a block without a data edge', () => {
    const clock = edge('/::clk#1', 'clock', '/ps', '/clk_wiz');
    const reset = edge('/::rst#1', 'reset', '/clk_wiz', '/rst');
    expect(placementEdges([data, clock, reset])).toEqual([data, clock, reset]);
  });

  it('counts a data edge from the block as well as into it', () => {
    const clock = edge('/::clk#1', 'clock', '/smc', '/ps');
    expect(placementEdges([clock, data])).toEqual([data]);
  });

  it('anchors a driver whose loads all have data edges by its first clock or reset edge', () => {
    const toSmc = edge('/::ext_clk#1', 'clock', '/::ext_clk', '/smc');
    const toDma = edge('/::ext_clk#2', 'clock', '/::ext_clk', '/dma');
    const reset = edge('/::ext_rst#1', 'reset', '/::ext_rst', '/dma');
    expect(placementEdges([data, toDma, stream, reset, toSmc])).toEqual([
      data,
      toDma,
      stream,
      reset,
    ]);
  });

  it('anchors no extra edge for a driver that already has a kept edge', () => {
    const toWizard = edge('/::clk#1', 'clock', '/ps', '/clk_wiz');
    const toSmc = edge('/::clk#2', 'clock', '/ps', '/smc');
    const fromWizard = edge('/::wclk#1', 'clock', '/clk_wiz', '/dma');
    expect(placementEdges([data, stream, toWizard, toSmc, fromWizard])).toEqual([
      data,
      stream,
      toWizard,
    ]);
  });

  it('keeps an inner clock edge from the frame of an expanded block into a block without data edges', () => {
    // After `remapBoundaryEnds`, the boundary pin of the inner level is the frame node itself.
    const inData = edge('/dsp::s#1', 'axis', '/dsp', '/dsp/fir');
    const toMonitor = edge('/dsp::aclk#1', 'clock', '/dsp', '/dsp/monitor');
    const toFir = edge('/dsp::aclk#2', 'clock', '/dsp', '/dsp/fir');
    expect(placementEdges([inData, toMonitor, toFir])).toEqual([inData, toMonitor]);
  });

  it('preserves the input order', () => {
    const clock = edge('/::clk#1', 'clock', '/ps', '/clk_wiz');
    const dropped = edge('/::clk#2', 'clock', '/clk_wiz', '/dma');
    const reset = edge('/::rst#1', 'reset', '/clk_wiz', '/rst');
    expect(placementEdges([reset, stream, dropped, clock, data])).toEqual([
      reset,
      stream,
      clock,
      data,
    ]);
  });
});
