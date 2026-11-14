import {
  buildSystemExportView,
  visibleNodeIds,
} from '../../../../webview/systemDiagram/exportView';
import type { DiagramFlowNode } from '../../../../webview/systemDiagram/layout/elkLayout';

function node(id: string, x: number, y: number, type: 'boundary' | 'frame' = 'boundary') {
  return {
    id,
    type,
    position: { x, y },
    width: 100,
    height: 50,
    data: type === 'frame' ? { west: [], east: [] } : {},
  } as unknown as DiagramFlowNode;
}

const nodes = [node('a', 0, 0), node('b', 400, 0), node('c', 0, 400), node('far', 5000, 5000)];

describe('visibleNodeIds', () => {
  it('lists the nodes that overlap the viewport rectangle', () => {
    // Zoom 1, no pan: the 500 x 300 viewport shows world x 0..500, y 0..300.
    expect(visibleNodeIds(nodes, { transform: [0, 0, 1], width: 500, height: 300 })).toEqual([
      'a',
      'b',
    ]);
  });

  it('follows pan and zoom', () => {
    // Zoom 2 and pan (-800, -800): world x 400..650, y 400..550.
    expect(visibleNodeIds(nodes, { transform: [-800, -800, 2], width: 500, height: 300 })).toEqual(
      []
    );
    // Panned so that world x -50..450, y 380..680 is in view: only c and not b.
    expect(visibleNodeIds(nodes, { transform: [50, -380, 1], width: 500, height: 300 })).toEqual([
      'c',
    ]);
    // Zoomed out 0.1: everything within 400 / 0.1 is in view.
    expect(visibleNodeIds(nodes, { transform: [0, 0, 0.1], width: 400, height: 400 })).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('counts a node that is only partly in view', () => {
    expect(visibleNodeIds(nodes, { transform: [-350, 0, 1], width: 100, height: 100 })).toEqual([
      'b',
    ]);
  });

  it('leaves out a frame unless it is all that is in view', () => {
    const withFrame = [node('frame', -50, -50, 'frame'), ...nodes];
    expect(visibleNodeIds(withFrame, { transform: [0, 0, 1], width: 500, height: 300 })).toEqual([
      'a',
      'b',
    ]);
    expect(visibleNodeIds(withFrame, { transform: [20, 20, 1], width: 20, height: 20 })).toEqual([
      'frame',
    ]);
  });
});

describe('buildSystemExportView', () => {
  const base = {
    levelPath: '/dsp',
    expanded: new Set(['/dsp/fir']),
    isolation: null,
    clocksOn: true,
    selectedNodeIds: ['/dsp/mix'],
    marksOn: false,
  };

  it('carries marks only while they are on the canvas', () => {
    expect(buildSystemExportView(base)).not.toHaveProperty('marks');
    expect(buildSystemExportView({ ...base, marksOn: true })).toMatchObject({ marks: true });
  });

  it('carries the level, expanded blocks, clocks and selection', () => {
    expect(buildSystemExportView(base)).toEqual({
      levelPath: '/dsp',
      expanded: ['/dsp/fir'],
      clocks: true,
      selectedNodeIds: ['/dsp/mix'],
    });
  });

  it('adds the isolation seeds and radius, and the visible nodes for Current view', () => {
    expect(
      buildSystemExportView({ ...base, isolation: { seedIds: ['/dsp/mix'], hops: 2 } }, [
        '/dsp/mix',
      ])
    ).toMatchObject({
      isolate: { nodeIds: ['/dsp/mix'], hops: 2 },
      visibleNodeIds: ['/dsp/mix'],
    });
  });
});
