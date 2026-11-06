import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { diagramBounds, nodeBounds } from '../../../../webview/systemDiagram/layout/diagramBounds';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import type {
  DiagramFlowEdge,
  DiagramFlowNode,
} from '../../../../webview/systemDiagram/layout/elkLayout';
import { loadFixtureGraph, fakeMeasure } from './fixtureGraph';

const badge = { netId: 'n', netName: 'n', category: 'clock' as const, text: 'n' };

function boundaryNode(id: string, x: number, y: number, badgeBox?: object): DiagramFlowNode {
  return {
    id,
    type: 'boundary',
    position: { x, y },
    width: 150,
    height: 26,
    draggable: false,
    data: {
      pin: { name: id } as never,
      width: 150,
      label: id,
      side: 'west',
      netNames: [],
      badge: badgeBox ? ({ ...badge, ...badgeBox } as never) : undefined,
    },
  };
}

function frameNode(x: number, y: number, badgeBox?: object): DiagramFlowNode {
  const row = {
    name: 'aclk',
    y: 60,
    badge: badgeBox ? { ...badge, ...badgeBox } : undefined,
  };
  return {
    id: '/frame',
    type: 'frame',
    position: { x, y },
    width: 400,
    height: 300,
    draggable: false,
    zIndex: -1,
    data: { instance: {} as never, cellCount: 3, west: [row as never], east: [] },
  };
}

describe('diagramBounds', () => {
  it('is null for an empty layout', () => {
    expect(diagramBounds({ nodes: [], edges: [] })).toBeNull();
  });

  it('covers node boxes', () => {
    expect(
      diagramBounds({
        nodes: [boundaryNode('a', 10, 20), boundaryNode('b', 300, 100)],
        edges: [],
      })
    ).toEqual({ x: 10, y: 20, width: 440, height: 106 });
  });

  it('extends to the left of the leftmost node for a west badge', () => {
    const bounds = diagramBounds({
      nodes: [boundaryNode('a', 10, 20, { x: -90, y: 4, width: 86, height: 14 })],
      edges: [],
    });
    expect(bounds?.x).toBe(-80);
    expect(bounds?.width).toBe(240);
  });

  it('includes edge points', () => {
    const edge = {
      data: {
        points: [
          { x: -50, y: -5 },
          { x: 700, y: 400 },
        ],
      },
    } as unknown as DiagramFlowEdge;
    expect(diagramBounds({ nodes: [boundaryNode('a', 10, 20)], edges: [edge] })).toEqual({
      x: -50,
      y: -5,
      width: 750,
      height: 405,
    });
  });

  it('contains every badge of the real fixture layout', async () => {
    const graph = loadFixtureGraph();
    const result = await runElkLayout(
      buildElkInput(graph, '/', { showClockReset: false, measure: fakeMeasure })
    );
    const layout = toFlowElements(result, graph, '/', fakeMeasure);
    const bounds = diagramBounds(layout)!;
    let leftmostNode = Infinity;
    let leftmostBadge = Infinity;
    for (const node of layout.nodes) {
      leftmostNode = Math.min(leftmostNode, node.position.x);
      const rows = node.type === 'boundary' ? [node.data] : [...node.data.west, ...node.data.east];
      for (const row of rows) {
        if (row.badge) {
          leftmostBadge = Math.min(leftmostBadge, node.position.x + row.badge.x);
        }
      }
    }
    expect(leftmostBadge).toBeLessThan(leftmostNode);
    expect(bounds.x).toBeLessThanOrEqual(leftmostBadge);
  }, 20000);
});

describe('nodeBounds of a frame', () => {
  it('is the frame box, or extends to the badge of a pin', () => {
    expect(nodeBounds(frameNode(10, 20))).toEqual({ x: 10, y: 20, width: 400, height: 300 });
    expect(nodeBounds(frameNode(10, 20, { x: -90, y: 55, width: 86, height: 14 }))).toEqual({
      x: -80,
      y: 20,
      width: 490,
      height: 300,
    });
  });
});

describe('nodeBounds', () => {
  it('is the node box when it has no badges', () => {
    expect(nodeBounds(boundaryNode('a', 10, 20))).toEqual({ x: 10, y: 20, width: 150, height: 26 });
  });

  it('extends to a boundary node badge', () => {
    expect(nodeBounds(boundaryNode('a', 10, 20, { x: -90, y: 4, width: 86, height: 14 }))).toEqual({
      x: -80,
      y: 20,
      width: 240,
      height: 26,
    });
  });

  it('covers west and east badges of an instance node', () => {
    const instance = {
      id: '/i',
      type: 'instance',
      position: { x: 100, y: 50 },
      width: 200,
      height: 80,
      data: {
        west: [{ badge: { ...badge, x: -60, y: 10, width: 50, height: 14 } }, {}],
        east: [{ badge: { ...badge, x: 210, y: 70, width: 40, height: 14 } }],
      },
    } as unknown as DiagramFlowNode;
    expect(nodeBounds(instance)).toEqual({ x: 40, y: 50, width: 310, height: 80 + 4 });
  });
});
