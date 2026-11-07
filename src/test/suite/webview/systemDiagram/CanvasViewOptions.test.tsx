import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { DiagramCanvas } from '../../../../webview/systemDiagram/DiagramCanvas';
import { useViewOptions } from '../../../../webview/systemDiagram/hooks/useViewOptions';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { archGraph } from './archGraph';
import { clockContextOf } from './clockContext';
import { fakeMeasure } from './fixtureGraph';

// Real @xyflow/react: the legend filters, Auto detail and the minimap are drawn, never laid out.
// The store holds the nodes and edges the canvas hands React Flow.
const graph = archGraph();
let store: ReturnType<typeof useStoreApi>;

function Probe() {
  store = useStoreApi();
  return null;
}

function Harness({ layout }: { layout: React.ComponentProps<typeof DiagramCanvas>['layout'] }) {
  const view = useViewOptions();
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
        drawClockReset={false}
        focusedPin={null}
        query=""
        view={view}
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
  const options = { measure: fakeMeasure, busBundling: { unbundled: new Set<string>() } };
  const laidOut = await runElkLayout(buildElkInput(graph, '/', options));
  layout = {
    levelPath: '/',
    viewKey: '/',
    ...toFlowElements(laidOut, graph, '/', fakeMeasure, undefined, options.busBundling),
  };
}, 20000);

const chip = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const drawnCategories = () => store.getState().edges.map((edge) => edge.data?.category);
const placement = () =>
  store
    .getState()
    .nodes.map(({ id, position, width, height }) => ({ id, position, width, height }));
const container = () => document.querySelector('[data-review]') as HTMLElement;

describe('the legend as layer filters', () => {
  beforeEach(() => {
    render(<Harness layout={layout} />);
  });

  it('lists the categories of the level as pressed buttons', () => {
    expect(chip('AXI4-Stream')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('AXI memory-mapped')).toHaveAttribute('aria-pressed', 'true');
    expect(drawnCategories()).toContain('axis');
  });

  it('hides the wires of a category on a click and shows them on the next, moving no block', () => {
    const before = placement();
    fireEvent.click(chip('AXI4-Stream'));
    expect(chip('AXI4-Stream')).toHaveAttribute('aria-pressed', 'false');
    expect(drawnCategories()).not.toContain('axis');
    expect(drawnCategories()).toContain('aximm');
    expect(placement()).toEqual(before);
    fireEvent.click(chip('AXI4-Stream'));
    expect(drawnCategories()).toContain('axis');
    expect(placement()).toEqual(before);
  });

  it('shows only the category on an Alt+Click and all again on the second', () => {
    fireEvent.click(chip('AXI4-Stream'), { altKey: true });
    expect([...new Set(drawnCategories())]).toEqual(['axis']);
    expect(chip('AXI4-Stream')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('AXI memory-mapped')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip('AXI4-Stream'), { altKey: true });
    expect(new Set(drawnCategories()).size).toBeGreaterThan(1);
    expect(chip('AXI memory-mapped')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the minimap', () => {
  beforeEach(() => {
    render(<Harness layout={layout} />);
  });

  it('is hidden on a small level, shown and hidden again by its button, moving no block', () => {
    const before = placement();
    expect(screen.queryByLabelText('Minimap')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show minimap' }));
    expect(screen.getByLabelText('Minimap')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide minimap' }));
    expect(screen.queryByLabelText('Minimap')).toBeNull();
    expect(placement()).toEqual(before);
  });
});

describe('Auto detail', () => {
  beforeEach(() => {
    render(<Harness layout={layout} />);
  });

  const zoomTo = (zoom: number) => act(() => store.setState({ transform: [0, 0, zoom] }));

  it('marks the canvas far below 0.42 and scales names, leaving every node size alone', () => {
    const before = placement();
    expect(container().dataset.far).toBe('false');
    zoomTo(0.3);
    expect(container().dataset.far).toBe('true');
    expect(Number(container().style.getPropertyValue('--sd-name-scale'))).toBeCloseTo(3);
    zoomTo(0.5);
    expect(container().dataset.far).toBe('false');
    expect(Number(container().style.getPropertyValue('--sd-name-scale'))).toBeCloseTo(2);
    expect(placement()).toEqual(before);
  });
});
