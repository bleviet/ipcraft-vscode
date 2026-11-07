import { drawnLayout } from '../../../../webview/systemDiagram/drawnLayout';
import {
  buildElkInput,
  toFlowElements,
  type DiagramFlowNode,
} from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { fakeMeasure, loadFixtureGraph } from './fixtureGraph';

const graph = loadFixtureGraph();
const DSP = '/dsp_pipeline';

async function layoutOf(expanded: string[] = []) {
  const laidOut = await runElkLayout(
    buildElkInput(graph, '/', { measure: fakeMeasure, expanded: new Set(expanded) })
  );
  return toFlowElements(laidOut, graph, '/', fakeMeasure);
}

const badgesOf = (node: DiagramFlowNode) =>
  node.type === 'boundary'
    ? [node.data.badge]
    : [...node.data.west, ...node.data.east].map((row) => row.badge);
const hasBadge = (node: DiagramFlowNode) => badgesOf(node).some((badge) => badge !== undefined);
const isClockOrResetEdge = (edge: { data: { category: string } }) =>
  edge.data.category === 'clock' || edge.data.category === 'reset';

describe('drawnLayout', () => {
  let layout: Awaited<ReturnType<typeof layoutOf>>;
  beforeAll(async () => {
    layout = await layoutOf();
  }, 20000);

  it('holds both the clock and reset wires and their badges in the layout', () => {
    expect(layout.edges.some(isClockOrResetEdge)).toBe(true);
    expect(layout.nodes.some(hasBadge)).toBe(true);
  });

  it('keeps the badges and drops the clock and reset wires while the wires are off', () => {
    const drawn = drawnLayout(layout, false);
    expect(drawn.edges.length).toBeGreaterThan(0);
    expect(drawn.edges.some(isClockOrResetEdge)).toBe(false);
    expect(drawn.edges).toEqual(layout.edges.filter((edge) => !isClockOrResetEdge(edge)));
    expect(drawn.nodes).toBe(layout.nodes);
  });

  it('keeps the wires and drops every badge while the wires are drawn', () => {
    const drawn = drawnLayout(layout, true);
    expect(drawn.edges).toBe(layout.edges);
    expect(drawn.nodes).toHaveLength(layout.nodes.length);
    expect(drawn.nodes.some(hasBadge)).toBe(false);
  });

  it('changes nothing else about a block: place, size, pins and flags', () => {
    const drawn = drawnLayout(layout, true);
    drawn.nodes.forEach((node, index) => {
      const original = layout.nodes[index];
      expect(node.id).toBe(original.id);
      expect(node.position).toBe(original.position);
      expect({ ...node, data: undefined }).toEqual({ ...original, data: undefined });
      if (node.type !== 'boundary' && original.type !== 'boundary') {
        const stripped = [...original.data.west, ...original.data.east].map((row) => ({
          ...row,
          badge: undefined,
        }));
        expect([...node.data.west, ...node.data.east]).toEqual(stripped);
      } else if (node.type === 'boundary' && original.type === 'boundary') {
        expect(node.data).toEqual({ ...original.data, badge: undefined });
      }
    });
  });

  it('returns the blocks that carry no badge as they are', () => {
    const drawn = drawnLayout(layout, true);
    layout.nodes.forEach((node, index) => {
      if (!hasBadge(node)) {
        expect(drawn.nodes[index]).toBe(node);
      }
    });
    expect(layout.nodes.some((node) => !hasBadge(node))).toBe(true);
  });

  it('does not touch the layout it is given', () => {
    const before = JSON.stringify(layout);
    drawnLayout(layout, true);
    drawnLayout(layout, false);
    expect(JSON.stringify(layout)).toBe(before);
  });

  it('drops the badges of an expanded block, whose pins keep their height', async () => {
    const expanded = await layoutOf([DSP]);
    const frame = expanded.nodes.find((node) => node.id === DSP);
    if (frame?.type !== 'frame') {
      throw new Error('expected a frame');
    }
    expect(hasBadge(frame)).toBe(true);
    const drawn = drawnLayout(expanded, true).nodes.find((node) => node.id === DSP);
    if (drawn?.type !== 'frame') {
      throw new Error('expected a frame');
    }
    expect(hasBadge(drawn)).toBe(false);
    expect([...drawn.data.west, ...drawn.data.east].map((row) => row.y)).toEqual(
      [...frame.data.west, ...frame.data.east].map((row) => row.y)
    );
  }, 20000);
});
