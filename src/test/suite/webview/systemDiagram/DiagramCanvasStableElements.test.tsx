import React from 'react';
import { render } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { DiagramCanvas } from '../../../../webview/systemDiagram/DiagramCanvas';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import type { Selection } from '../../../../webview/systemDiagram/model';
import { clockContextOf } from './clockContext';
import { loadFixtureGraph, fakeMeasure } from './fixtureGraph';

// Real @xyflow/react: the nodes and edges in the store are the objects the canvas handed
// over, so identity there is what lets React Flow skip an element it already drew.
const graph = loadFixtureGraph();
const clocks = clockContextOf(graph);
let store: ReturnType<typeof useStoreApi>;

function Probe() {
  store = useStoreApi();
  return null;
}

// Stable across renders, as the workbench's handlers are.
const handlers = {
  onSelect: jest.fn(),
  onToggleNode: jest.fn(),
  onIsolate: jest.fn(),
  onShowAll: jest.fn(),
  onEnterHierarchy: jest.fn(),
  onToggleExpand: jest.fn(),
  isolatable: jest.fn(),
  onFocusNode: jest.fn(),
  onFit: jest.fn(),
};

// Counts the renders of every collapsed block, through its header.
const headerRenders: string[] = [];
jest.mock('../../../../webview/systemDiagram/NodeHeader', () => {
  const actual = jest.requireActual<typeof import('../../../../webview/systemDiagram/NodeHeader')>(
    '../../../../webview/systemDiagram/NodeHeader'
  );
  return {
    ...actual,
    NodeHeader: (props: React.ComponentProps<typeof actual.NodeHeader>) => {
      headerRenders.push(props.instance.name);
      return actual.NodeHeader(props);
    },
  };
});

type Props = React.ComponentProps<typeof DiagramCanvas>;

function Harness({
  layout,
  query = '',
  selection = null,
  selectedNodeIds = [],
  onSelect = handlers.onSelect,
}: {
  layout: Props['layout'];
  query?: string;
  selection?: Selection | null;
  selectedNodeIds?: string[];
  onSelect?: Props['onSelect'];
}) {
  return (
    <ReactFlowProvider>
      <Probe />
      <DiagramCanvas
        layout={layout}
        error={null}
        selection={selection}
        selectedNodeIds={selectedNodeIds}
        isolated={false}
        review={null}
        clocks={clocks}
        focusedPin={null}
        query={query}
        {...handlers}
        onSelect={onSelect}
      />
    </ReactFlowProvider>
  );
}

let layout: NonNullable<Props['layout']>;

beforeAll(async () => {
  const laidOut = await runElkLayout(buildElkInput(graph, '/', { measure: fakeMeasure }));
  layout = {
    levelPath: '/',
    viewKey: '/',
    ...toFlowElements(laidOut, graph, '/', fakeMeasure),
  };
}, 20000);

const userNodes = () => new Map(store.getState().nodes.map((n) => [n.id, n]));
const userEdges = () => new Map(store.getState().edges.map((e) => [e.id, e]));
const dimmed = (n: { className?: string }) => n.className === 'sd-dimmed';

describe('Stable React Flow elements', () => {
  it('re-creates only the nodes whose dimming changes when the query changes', () => {
    const { rerender } = render(<Harness layout={layout} />);
    const before = userNodes();
    const edgesBefore = userEdges();
    rerender(<Harness layout={layout} query="dma" />);
    const after = userNodes();
    const changed = [...after.values()].filter((n) => n !== before.get(n.id));
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThan(after.size);
    for (const node of changed) {
      expect(dimmed(node)).not.toBe(dimmed(before.get(node.id)!));
    }
    for (const [id, edge] of userEdges()) {
      expect(edge).toBe(edgesBefore.get(id));
    }
  });

  it('keeps every node and edge when a render changes nothing', () => {
    const { rerender } = render(<Harness layout={layout} query="dma" />);
    const nodes = userNodes();
    const edges = userEdges();
    rerender(<Harness layout={layout} query="dma" />);
    for (const [id, node] of userNodes()) {
      expect(node).toBe(nodes.get(id));
    }
    for (const [id, edge] of userEdges()) {
      expect(edge).toBe(edges.get(id));
    }
  });

  it('keeps the nodes when only the selection handler changes', () => {
    const { rerender } = render(<Harness layout={layout} />);
    const before = userNodes();
    rerender(<Harness layout={layout} onSelect={jest.fn()} />);
    for (const [id, node] of userNodes()) {
      expect(node).toBe(before.get(id));
    }
  });

  it('re-creates only the selected block when a block is selected', () => {
    const { rerender } = render(<Harness layout={layout} />);
    const before = userNodes();
    const edgesBefore = userEdges();
    const id = layout.nodes[0].id;
    rerender(
      <Harness layout={layout} selection={{ kind: 'instance', id }} selectedNodeIds={[id]} />
    );
    const changed = [...userNodes().values()].filter((n) => n !== before.get(n.id));
    expect(changed.map((n) => n.id)).toEqual([id]);
    for (const [edgeId, edge] of userEdges()) {
      expect(edge).toBe(edgesBefore.get(edgeId));
    }
  });

  it('re-creates only the wires of the selected net when a net is selected', () => {
    const { rerender } = render(<Harness layout={layout} />);
    const edgesBefore = userEdges();
    const netId = layout.edges[0].data.netId;
    rerender(<Harness layout={layout} selection={{ kind: 'net', id: netId }} />);
    const changed = [...userEdges().values()].filter((e) => e !== edgesBefore.get(e.id));
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThan(edgesBefore.size);
    for (const edge of changed) {
      expect((edge.data as { netId: string }).netId).toBe(netId);
    }
  });

  it('dims a block with a class and without rendering its node component', () => {
    const { rerender } = render(<Harness layout={layout} />);
    const before = userNodes();
    expect(headerRenders.length).toBeGreaterThan(0);
    headerRenders.length = 0;
    rerender(<Harness layout={layout} query="dma" />);
    const changed = [...userNodes().values()].filter((n) => n !== before.get(n.id));
    expect(changed.length).toBeGreaterThan(0);
    for (const node of changed) {
      expect(node.data).toBe(before.get(node.id)!.data);
    }
    expect(headerRenders).toEqual([]);
  });
});
