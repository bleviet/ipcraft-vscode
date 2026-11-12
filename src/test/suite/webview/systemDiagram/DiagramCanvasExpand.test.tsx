import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { DiagramCanvas } from '../../../../webview/systemDiagram/DiagramCanvas';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { isLevelNode } from '../../../../webview/systemDiagram/model';
import { unconnectedPins } from '../../../../webview/systemDiagram/unconnectedPins';
import { clockContextOf } from './clockContext';
import { loadFixtureGraph, loadReviewFixtureGraph, fakeMeasure } from './fixtureGraph';
import { stubCanvasSize } from './canvasSize';

stubCanvasSize();

// Uses the real @xyflow/react, like DiagramCanvasRealFlow: the expand toggle, the
// double-click and context-menu gestures, and the stacking of a frame.
const graph = loadFixtureGraph();
const DSP = '/dsp_pipeline';
const FIR = `${DSP}/fir_compiler_0`;

async function layoutOf(expanded: string[], design = graph) {
  const laidOut = await runElkLayout(
    buildElkInput(design, '/', {
      measure: fakeMeasure,
      expanded: new Set(expanded),
    })
  );
  return { levelPath: '/', viewKey: '/', ...toFlowElements(laidOut, design, '/', fakeMeasure) };
}

function canvas(
  layout: Awaited<ReturnType<typeof layoutOf>>,
  callbacks: Record<string, jest.Mock>,
  selectedNodeIds: string[],
  review: React.ComponentProps<typeof DiagramCanvas>['review'] = null
) {
  return (
    <ReactFlowProvider>
      <DiagramCanvas
        layout={layout}
        error={null}
        selection={selectedNodeIds[0] ? { kind: 'instance', id: selectedNodeIds[0] } : null}
        selectedNodeIds={selectedNodeIds}
        isolated={false}
        review={review}
        clocks={clockContextOf(graph)}
        focusedPin={null}
        matcher={null}
        isolatable={(ids) => ids.every((id) => isLevelNode(graph, '/', id))}
        onSelect={callbacks.onSelect}
        onToggleNode={callbacks.onToggleNode}
        onIsolate={callbacks.onIsolate}
        onShowAll={callbacks.onShowAll}
        onEnterHierarchy={callbacks.onEnterHierarchy}
        onToggleExpand={callbacks.onToggleExpand}
        onFocusNode={callbacks.onFocusNode}
        onFit={callbacks.onFit}
      />
    </ReactFlowProvider>
  );
}

function setup(
  layout: Awaited<ReturnType<typeof layoutOf>>,
  selectedNodeIds: string[] = [],
  review: React.ComponentProps<typeof DiagramCanvas>['review'] = null
) {
  const callbacks = {
    onSelect: jest.fn(),
    onToggleNode: jest.fn(),
    onIsolate: jest.fn(),
    onShowAll: jest.fn(),
    onEnterHierarchy: jest.fn(),
    onToggleExpand: jest.fn(),
    onFocusNode: jest.fn(),
    onFit: jest.fn(),
  };
  const view = render(canvas(layout, callbacks, selectedNodeIds, review));
  return {
    ...callbacks,
    select: (ids: string[]) => view.rerender(canvas(layout, callbacks, ids, review)),
  };
}

const menuItem = (name: string) => screen.queryByRole('menuitem', { name });

describe('collapsed hierarchy block', () => {
  let layout: Awaited<ReturnType<typeof layoutOf>>;
  beforeAll(async () => {
    layout = await layoutOf([]);
  }, 20000);

  it('expands in place from the toggle without selecting or opening the block', async () => {
    const callbacks = setup(layout);
    const toggle = await screen.findByRole('button', { name: 'Expand dsp_pipeline in place' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('title', 'Expand in place');
    fireEvent.click(toggle);
    expect(callbacks.onToggleExpand).toHaveBeenCalledTimes(1);
    expect(callbacks.onToggleExpand).toHaveBeenCalledWith(DSP);
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    expect(callbacks.onEnterHierarchy).not.toHaveBeenCalled();
  });

  it('does not dive in when the toggle is double-clicked', async () => {
    const callbacks = setup(layout);
    const toggle = await screen.findByRole('button', { name: 'Expand dsp_pipeline in place' });
    fireEvent.doubleClick(toggle);
    expect(callbacks.onEnterHierarchy).not.toHaveBeenCalled();
    expect(callbacks.onFocusNode).not.toHaveBeenCalled();
  });

  it('still dives in on a double-click of the block, and selects it on a click', async () => {
    const callbacks = setup(layout);
    const name = await screen.findByText('dsp_pipeline');
    fireEvent.click(name);
    expect(callbacks.onSelect).toHaveBeenCalledWith({ kind: 'instance', id: DSP });
    fireEvent.doubleClick(name);
    expect(callbacks.onEnterHierarchy).toHaveBeenCalledWith(DSP);
    expect(callbacks.onToggleExpand).not.toHaveBeenCalled();
  });

  it('offers Expand In-Place and Open Subsystem before Isolate in its context menu', async () => {
    const callbacks = setup(layout);
    fireEvent.contextMenu(await screen.findByText('dsp_pipeline'));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Expand In-Place',
      'Open Subsystem',
      'Isolate Selection',
      'Show All',
    ]);
    expect(menuItem('Isolate Selection')).not.toHaveAttribute('aria-disabled');
    fireEvent.click(menuItem('Expand In-Place')!);
    expect(callbacks.onToggleExpand).toHaveBeenCalledWith(DSP);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.contextMenu(screen.getByText('dsp_pipeline'));
    fireEvent.click(menuItem('Open Subsystem')!);
    expect(callbacks.onEnterHierarchy).toHaveBeenCalledWith(DSP);
  });

  it('adds nothing to the context menu of a block that is not a hierarchy', async () => {
    setup(layout);
    fireEvent.contextMenu(await screen.findByText('axi_dma_0'));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Isolate Selection',
      'Show All',
    ]);
    expect(screen.queryByRole('button', { name: /axi_dma_0 in place/ })).toBeNull();
  });
});

describe('expanded hierarchy block', () => {
  let layout: Awaited<ReturnType<typeof layoutOf>>;
  beforeAll(async () => {
    layout = await layoutOf([DSP]);
  }, 20000);

  it('collapses from the toggle in its header', async () => {
    const callbacks = setup(layout);
    const toggle = await screen.findByRole('button', { name: 'Collapse dsp_pipeline' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('title', 'Collapse');
    fireEvent.doubleClick(toggle);
    expect(callbacks.onEnterHierarchy).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(callbacks.onToggleExpand).toHaveBeenCalledWith(DSP);
    expect(callbacks.onSelect).not.toHaveBeenCalled();
  });

  it('draws the inner blocks and the pins of the frame', async () => {
    setup(layout);
    expect(await screen.findByText('fir_compiler_0')).toBeInTheDocument();
    expect(screen.getByText('axis_data_fifo_0')).toBeInTheDocument();
    expect(screen.getAllByText('S_AXIS').length).toBeGreaterThan(0);
    const frame = document.querySelector('.sd-frame');
    expect(frame?.querySelectorAll('.sd-frame-pin')).toHaveLength(4);
  });

  it('dives in on a double-click of the frame', async () => {
    const callbacks = setup(layout);
    fireEvent.doubleClick(await screen.findByText('dsp_pipeline'));
    expect(callbacks.onEnterHierarchy).toHaveBeenCalledWith(DSP);
    expect(callbacks.onFocusNode).not.toHaveBeenCalled();
  });

  it('offers Collapse and Open Subsystem on the frame', async () => {
    const callbacks = setup(layout);
    fireEvent.contextMenu(await screen.findByText('dsp_pipeline'));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Collapse',
      'Open Subsystem',
      'Isolate Selection',
      'Show All',
    ]);
    expect(menuItem('Expand In-Place')).toBeNull();
    fireEvent.click(menuItem('Collapse')!);
    expect(callbacks.onToggleExpand).toHaveBeenCalledWith(DSP);

    fireEvent.contextMenu(screen.getByText('dsp_pipeline'));
    fireEvent.click(menuItem('Open Subsystem')!);
    expect(callbacks.onEnterHierarchy).toHaveBeenCalledWith(DSP);
  });

  it('disables Isolate for a block inside the frame', async () => {
    const callbacks = setup(layout);
    fireEvent.contextMenu(await screen.findByText('fir_compiler_0'));
    expect(menuItem('Isolate Selection')).toHaveAttribute('aria-disabled', 'true');
    expect(callbacks.onSelect).toHaveBeenCalledWith({ kind: 'instance', id: FIR });
    fireEvent.click(menuItem('Isolate Selection')!);
    expect(callbacks.onIsolate).not.toHaveBeenCalled();
    expect(menuItem('Expand In-Place')).toBeNull();
  });

  it('keeps the frame below its inner blocks, also while it is selected', async () => {
    const canvasView = setup(layout);
    await screen.findByText('fir_compiler_0');
    const zIndexOf = (id: string) =>
      Number(
        document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)?.style.zIndex
      );
    expect([zIndexOf(DSP), zIndexOf(FIR), zIndexOf('/axi_dma_0')]).toEqual([-1, 0, 0]);

    canvasView.select([DSP]);
    expect(document.querySelector('.sd-frame')).toHaveAttribute('data-selected', 'true');
    expect([zIndexOf(DSP), zIndexOf(FIR)]).toEqual([-1, 0]);
    canvasView.select([FIR]);
    expect([zIndexOf(DSP), zIndexOf(FIR)]).toEqual([-1, 0]);
  });
});

describe('frame pins', () => {
  let layout: Awaited<ReturnType<typeof layoutOf>>;
  beforeAll(async () => {
    layout = await layoutOf([DSP]);
  }, 20000);

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('opens the hover card of a pin with the nets of both sides', async () => {
    setup(layout);
    const frame = document.querySelector<HTMLElement>('.sd-frame')!;
    const pin = within(frame).getByText('S_AXIS').closest('.sd-frame-pin')!;
    fireEvent.pointerEnter(pin);
    act(() => {
      jest.advanceTimersByTime(150);
    });
    const card = screen.getByRole('tooltip');
    expect(card).toHaveTextContent('S_AXIS');
    expect(card).toHaveTextContent('axi_dma_0_M_AXIS_MM2S');
    expect(card).toHaveTextContent('Conn1');
    fireEvent.pointerLeave(pin);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('frame in review mode', () => {
  it('shows the unconnected count of everything inside the frame', async () => {
    const design = loadReviewFixtureGraph();
    const layout = await layoutOf([DSP], design);
    setup(layout, [], {
      graph: design,
      findings: unconnectedPins(design),
    });
    const frame = document.querySelector<HTMLElement>('.sd-frame')!;
    expect(frame).toHaveAttribute('data-has-unc', 'true');
    expect(within(frame).getByRole('img', { name: /unconnected pins/ })).toBeInTheDocument();
  }, 20000);
});
