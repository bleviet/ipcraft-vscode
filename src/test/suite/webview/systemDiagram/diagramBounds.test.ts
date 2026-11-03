import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { diagramBounds } from '../../../../webview/systemDiagram/layout/diagramBounds';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import type {
  DiagramFlowEdge,
  DiagramFlowNode,
} from '../../../../webview/systemDiagram/layout/elkLayout';
import { loadFixtureGraph } from './fixtureGraph';

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
      side: 'west',
      badge: badgeBox ? ({ ...badge, ...badgeBox } as never) : undefined,
    },
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
    const result = await runElkLayout(buildElkInput(graph, '/', { showClockReset: false }));
    const layout = toFlowElements(result, graph, '/');
    const bounds = diagramBounds(layout)!;
    let leftmostNode = Infinity;
    let leftmostBadge = Infinity;
    for (const node of layout.nodes) {
      leftmostNode = Math.min(leftmostNode, node.position.x);
      const rows = node.type === 'instance' ? [...node.data.west, ...node.data.east] : [node.data];
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
