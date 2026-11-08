import React from 'react';
import { render } from '@testing-library/react';
import { ReactFlow, ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { BoundaryNode } from '../../../../webview/systemDiagram/BoundaryNode';
import { FrameNode } from '../../../../webview/systemDiagram/FrameNode';
import { InstanceNode } from '../../../../webview/systemDiagram/InstanceNode';
import { DiagramCanvas } from '../../../../webview/systemDiagram/DiagramCanvas';
import type { DiagramFlowNode } from '../../../../webview/systemDiagram/layout/elkLayout';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import type { SystemGraph } from '../../../../domain/systemGraph';
import { stubCanvasSize } from './canvasSize';
import { clockContextOf } from './clockContext';
import { fakeMeasure, loadFixtureGraph } from './fixtureGraph';

// Real @xyflow/react. The layout gives each node the handles its component renders, so React
// Flow never has to measure them: a node that is not mounted (onlyRenderVisibleElements) still
// has handles that match its current pins, and its wires stay drawn.
const graph = loadFixtureGraph();
const DSP = '/dsp_pipeline';
let store: ReturnType<typeof useStoreApi>;

function Probe() {
  store = useStoreApi();
  return null;
}

type Layout = NonNullable<React.ComponentProps<typeof DiagramCanvas>['layout']>;

async function layoutOf(design: SystemGraph, expanded: string[] = []): Promise<Layout> {
  const laidOut = await runElkLayout(
    buildElkInput(design, '/', { measure: fakeMeasure, expanded: new Set(expanded) })
  );
  return { levelPath: '/', viewKey: '/', ...toFlowElements(laidOut, design, '/', fakeMeasure) };
}

const noop = jest.fn();
function Harness({ design, layout }: { design: SystemGraph; layout: Layout }) {
  return (
    <ReactFlowProvider>
      <Probe />
      <DiagramCanvas
        layout={layout}
        error={null}
        selection={null}
        selectedNodeIds={[]}
        isolated={false}
        review={null}
        clocks={clockContextOf(design)}
        focusedPin={null}
        query=""
        onSelect={noop}
        onToggleNode={noop}
        onIsolate={noop}
        onShowAll={noop}
        onEnterHierarchy={noop}
        onToggleExpand={noop}
        isolatable={noop}
        onFocusNode={noop}
        onFit={noop}
      />
    </ReactFlowProvider>
  );
}

/** The graph with one pin of `/processing_system7_0` renamed to a name of the same length. */
function renamed(from: string, to: string): SystemGraph {
  const copy = JSON.parse(JSON.stringify(graph)) as SystemGraph;
  const ps = copy.instances['/processing_system7_0'];
  for (const pin of ps.pins) {
    if (pin.name === from) {
      pin.name = to;
    }
  }
  for (const net of copy.nets) {
    for (const end of net.endpoints) {
      if (end.instance === '/processing_system7_0' && end.pin === from) {
        end.pin = to;
      }
    }
  }
  return copy;
}

describe('node handles from the layout', () => {
  it('gives every flow node measured equal to its size', async () => {
    const layout = await layoutOf(graph, [DSP]);
    expect(layout.nodes.length).toBeGreaterThan(0);
    for (const node of layout.nodes) {
      expect(node.measured).toEqual({ width: node.width, height: node.height });
    }
  });

  it('gives instance, frame and boundary nodes the handles their components render', async () => {
    const layout = await layoutOf(graph, [DSP]);
    const kinds = new Set(layout.nodes.map((node: DiagramFlowNode) => node.type));
    expect([...kinds].sort()).toEqual(['boundary', 'frame', 'instance']);
    // Unculled: in jsdom the pane has no size, React Flow falls back to 500x500 and would cull
    // the nodes outside it.
    render(
      <ReactFlowProvider>
        <ReactFlow
          nodes={layout.nodes}
          edges={[]}
          nodeTypes={{ instance: InstanceNode, boundary: BoundaryNode, frame: FrameNode }}
        />
      </ReactFlowProvider>
    );
    const seen = (id: string) =>
      [
        ...document
          .querySelector(`.react-flow__node[data-id="${id}"]`)!
          .querySelectorAll('.react-flow__handle[data-handleid]'),
      ]
        .filter((handle) => handle.closest('.react-flow__node')!.getAttribute('data-id') === id)
        .map((handle) => ({
          id: handle.getAttribute('data-handleid'),
          type: handle.classList.contains('source') ? 'source' : 'target',
          position: handle.getAttribute('data-handlepos'),
        }));
    const key = (h: { id?: string | null; type: string; position: unknown }) =>
      `${h.id}|${h.type}|${String(h.position)}`;
    for (const node of layout.nodes) {
      expect(node.handles.length).toBeGreaterThan(0);
      expect(seen(node.id).map(key).sort()).toEqual(node.handles.map(key).sort());
    }
  });
});

describe('node handles after a pin is renamed', () => {
  // The canvas is large, so the block is mounted (and measured) with its old pin first.
  stubCanvasSize();

  it('keeps the wires of a renamed pin on a node that keeps its size', async () => {
    const before = await layoutOf(graph);
    const design = renamed('DDR', 'DDZ');
    const after = await layoutOf(design);
    const sameSize = (id: string) =>
      before.nodes.find((n) => n.id === id)!.width === after.nodes.find((n) => n.id === id)!.width;
    expect(sameSize('/processing_system7_0')).toBe(true);

    const handleIds = () => {
      const bounds = store.getState().nodeLookup.get('/processing_system7_0')!.internals
        .handleBounds;
      return [...(bounds?.source ?? []), ...(bounds?.target ?? [])].map((h) => h.id);
    };
    const { rerender } = render(<Harness design={graph} layout={before} />);
    expect(
      document.querySelector('.react-flow__node[data-id="/processing_system7_0"]')
    ).not.toBeNull();
    expect(handleIds()).toContain('DDR');
    rerender(<Harness design={design} layout={after} />);

    const ids = handleIds();
    expect(ids).toContain('DDZ');
    expect(ids).not.toContain('DDR');
    const wires = after.edges.filter(
      (edge) => edge.sourceHandle === 'DDZ' || edge.targetHandle === 'DDZ'
    );
    expect(wires.length).toBeGreaterThan(0);
    // React Flow draws a wire only when both of its handles are known (error 008 otherwise).
    const handle = (nodeId: string, type: 'source' | 'target', id: string | null | undefined) =>
      store
        .getState()
        .nodeLookup.get(nodeId)
        ?.internals.handleBounds?.[type]?.find((candidate) => candidate.id === id);
    for (const wire of wires) {
      expect(handle(wire.source, 'source', wire.sourceHandle)).toBeDefined();
      expect(handle(wire.target, 'target', wire.targetHandle)).toBeDefined();
    }
  });
});
