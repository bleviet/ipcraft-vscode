import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { DiagramCanvas } from '../../../../webview/systemDiagram/DiagramCanvas';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { loadFixtureGraph, fakeMeasure } from './fixtureGraph';

// Uses the real @xyflow/react: its store resets when <ReactFlow> unmounts, so the
// canvas must stay mounted while a layout error is shown to keep the viewport.
let readTransform: () => [number, number, number] = () => [0, 0, 1];
let writeTransform: (transform: [number, number, number]) => void = () => undefined;

function StoreProbe() {
  const store = useStoreApi();
  readTransform = () => store.getState().transform;
  writeTransform = (transform) => store.setState({ transform });
  return null;
}

function Harness(props: React.ComponentProps<typeof DiagramCanvas>) {
  return (
    <ReactFlowProvider>
      <StoreProbe />
      <DiagramCanvas {...props} />
    </ReactFlowProvider>
  );
}

it('keeps the viewport when the layout fails and shows the error over the canvas', async () => {
  const graph = loadFixtureGraph();
  const laidOut = await runElkLayout(
    buildElkInput(graph, '/', { showClockReset: false, measure: fakeMeasure })
  );
  const layout = {
    levelPath: '/',
    viewKey: '/',
    ...toFlowElements(laidOut, graph, '/', fakeMeasure),
  };
  const common = {
    selection: null,
    selectedNodeIds: [],
    isolated: false,
    review: null,
    focusedPin: null,
    query: '',
    onSelect: jest.fn(),
    onToggleNode: jest.fn(),
    onIsolate: jest.fn(),
    onShowAll: jest.fn(),
    onEnterHierarchy: jest.fn(),
    onFocusNode: jest.fn(),
    onFit: jest.fn(),
  };

  const { rerender } = render(<Harness {...common} layout={layout} error={null} />);
  act(() => writeTransform([40, 50, 1.5]));

  rerender(<Harness {...common} layout={null} error="elk failed" />);

  expect(screen.getByRole('alert')).toHaveTextContent('Layout failed: elk failed');
  expect(document.querySelector('.react-flow')).not.toBeNull();
  expect(readTransform()).toEqual([40, 50, 1.5]);
});

it('fits on a double-click of the real pane but not of a real node', async () => {
  const graph = loadFixtureGraph();
  const laidOut = await runElkLayout(
    buildElkInput(graph, '/', { showClockReset: false, measure: fakeMeasure })
  );
  const layout = {
    levelPath: '/',
    viewKey: '/',
    ...toFlowElements(laidOut, graph, '/', fakeMeasure),
  };
  const onFit = jest.fn();
  const onFocusNode = jest.fn();
  render(
    <Harness
      selection={null}
      selectedNodeIds={[]}
      isolated={false}
      review={null}
      focusedPin={null}
      query=""
      onSelect={jest.fn()}
      onToggleNode={jest.fn()}
      onIsolate={jest.fn()}
      onShowAll={jest.fn()}
      onEnterHierarchy={jest.fn()}
      onFocusNode={onFocusNode}
      onFit={onFit}
      layout={layout}
      error={null}
    />
  );

  const node = await screen.findByText('axi_dma_0');
  fireEvent.doubleClick(node);
  expect(onFit).not.toHaveBeenCalled();

  fireEvent.doubleClick(document.querySelector('.react-flow__pane')!);
  expect(onFit).toHaveBeenCalledTimes(1);
});
