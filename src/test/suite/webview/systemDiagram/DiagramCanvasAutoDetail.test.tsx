import React from 'react';
import { act, render } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { DiagramCanvas } from '../../../../webview/systemDiagram/DiagramCanvas';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { clockContextOf } from './clockContext';
import { loadFixtureGraph, fakeMeasure } from './fixtureGraph';

// Real @xyflow/react: Auto detail is drawn, never laid out. The store holds the nodes the
// canvas hands React Flow.
const graph = loadFixtureGraph();
let store: ReturnType<typeof useStoreApi>;

function Probe() {
  store = useStoreApi();
  return null;
}

function Harness({
  layout,
  autoDetail,
}: {
  layout: React.ComponentProps<typeof DiagramCanvas>['layout'];
  autoDetail?: boolean;
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
        query=""
        autoDetail={autoDetail}
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

const zoomTo = (zoom: number) => act(() => store.setState({ transform: [0, 0, zoom] }));
const container = () => document.querySelector('[data-review]') as HTMLElement;
const placement = () =>
  store
    .getState()
    .nodes.map(({ id, position, width, height }) => ({ id, position, width, height }));

describe('Auto detail on the real canvas', () => {
  it('marks the canvas far below 0.42 and scales names, leaving every node size alone', () => {
    render(<Harness layout={layout} autoDetail />);
    const before = placement();
    expect(container().dataset.far).toBe('false');
    zoomTo(0.3);
    expect(container().dataset.far).toBe('true');
    expect(container().style.getPropertyValue('--sd-name-scale')).toBe('3');
    zoomTo(0.4);
    expect(container().style.getPropertyValue('--sd-name-scale')).toBe('2.5');
    zoomTo(0.5);
    expect(container().dataset.far).toBe('false');
    expect(container().style.getPropertyValue('--sd-name-scale')).toBe('');
    expect(placement()).toEqual(before);
  });

  it('leaves the canvas alone without the prop', () => {
    render(<Harness layout={layout} />);
    zoomTo(0.3);
    expect(container().hasAttribute('data-far')).toBe(false);
  });
});
