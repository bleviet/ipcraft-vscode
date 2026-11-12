import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { DiagramCanvas } from '../../../../webview/systemDiagram/DiagramCanvas';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { clockContextOf } from './clockContext';
import { loadFixtureGraph, fakeMeasure } from './fixtureGraph';

// Real @xyflow/react: The minimap is drawn, never laid out. The store holds the nodes the
// canvas hands React Flow.
const graph = loadFixtureGraph();
let store: ReturnType<typeof useStoreApi>;

function Probe() {
  store = useStoreApi();
  return null;
}

function Harness({
  layout,
  minimap,
}: {
  layout: React.ComponentProps<typeof DiagramCanvas>['layout'];
  minimap?: boolean;
}) {
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
        clocks={clockContextOf(graph)}
        focusedPin={null}
        matcher={null}
        minimap={minimap}
        onSelect={jest.fn()}
        onToggleNode={jest.fn()}
        onIsolate={jest.fn()}
        onShowAll={jest.fn()}
        onEnterHierarchy={jest.fn()}
        onToggleExpand={jest.fn()}
        isolatable={jest.fn()}
        onFocusNode={jest.fn()}
        onFit={jest.fn()}
      />
    </ReactFlowProvider>
  );
}

let layout: NonNullable<React.ComponentProps<typeof DiagramCanvas>['layout']>;

beforeAll(async () => {
  const laidOut = await runElkLayout(buildElkInput(graph, '/', { measure: fakeMeasure }));
  layout = {
    levelPath: '/',
    viewKey: '/',
    ...toFlowElements(laidOut, graph, '/', fakeMeasure),
  };
}, 20000);

const placement = () =>
  store
    .getState()
    .nodes.map(({ id, position, width, height }) => ({ id, position, width, height }));

const minimapEl = () => document.querySelector('.react-flow__minimap');

describe('Minimap on the real canvas', () => {
  it('is absent without the prop', () => {
    render(<Harness layout={layout} />);
    expect(minimapEl()).toBeNull();
    expect(screen.queryByLabelText('Minimap')).toBeNull();
  });

  it('shows one minimap node per flow node', () => {
    render(<Harness layout={layout} minimap />);
    expect(screen.getByLabelText('Minimap')).toBeInTheDocument();
    expect(document.querySelectorAll('.react-flow__minimap-node')).toHaveLength(
      store.getState().nodes.length
    );
  });

  it('toggling leaves the viewport and every node alone', () => {
    const { rerender } = render(<Harness layout={layout} />);
    act(() => store.setState({ transform: [12, 34, 0.7] }));
    const before = placement();
    rerender(<Harness layout={layout} minimap />);
    expect(minimapEl()).not.toBeNull();
    expect(store.getState().transform).toEqual([12, 34, 0.7]);
    expect(placement()).toEqual(before);
    rerender(<Harness layout={layout} />);
    expect(minimapEl()).toBeNull();
    expect(store.getState().transform).toEqual([12, 34, 0.7]);
    expect(placement()).toEqual(before);
  });
});
