import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { DiagramCanvas } from '../../../../webview/systemDiagram/DiagramCanvas';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { clockContextOf } from './clockContext';
import { loadFixtureGraph, fakeMeasure } from './fixtureGraph';

const clocks = clockContextOf(loadFixtureGraph());
const LONG = `${'long_pin_name_'.repeat(8)}end`;

async function longNameLayout() {
  const graph = JSON.parse(JSON.stringify(loadFixtureGraph())) as ReturnType<
    typeof loadFixtureGraph
  >;
  const dma = graph.instances['/axi_dma_0'];
  dma.pins[0].name = LONG;
  dma.pins[0].direction = 'in';
  for (const pin of dma.pins.slice(1)) {
    pin.direction = 'in';
  }
  const input = buildElkInput(graph, '/', { measure: fakeMeasure });
  const laidOut = await runElkLayout(input);
  return { levelPath: '/', viewKey: '/', ...toFlowElements(laidOut, graph, '/', fakeMeasure) };
}

type Layout = Awaited<ReturnType<typeof longNameLayout>>;

function canvas(layout: Layout) {
  return (
    <ReactFlowProvider>
      <DiagramCanvas
        layout={layout}
        error={null}
        selection={null}
        selectedNodeIds={[]}
        isolated={false}
        review={null}
        clocks={clocks}
        drawClockReset={false}
        focusedPin={null}
        query=""
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

function renderCanvas(layout: Layout) {
  return render(canvas(layout));
}

describe('long pin names', () => {
  let layout: Awaited<ReturnType<typeof longNameLayout>>;
  beforeAll(async () => {
    layout = await longNameLayout();
  }, 20000);

  it('shortens the label in the middle and keeps the full name as aria-label', () => {
    renderCanvas(layout);
    const row = screen.getByLabelText(LONG);
    expect(row.textContent).toContain('…');
    expect(row.textContent).not.toBe(LONG);
    expect(row).not.toHaveAttribute('title');
  });

  it('renders a one-sided block with its column at the full width', () => {
    renderCanvas(layout);
    const node = screen.getByLabelText(LONG).closest<HTMLElement>('.sd-node')!;
    const columns = Array.from(node.querySelectorAll<HTMLElement>('div.shrink-0'));
    expect(columns.map((column) => column.style.width)).toEqual([
      `${parseInt(node.style.width, 10) - 2}px`,
      '0px',
    ]);
  });

  describe('hover card', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('opens after the delay with name and nets, and closes on leave', () => {
      renderCanvas(layout);
      const row = screen.getByLabelText(LONG);
      fireEvent.pointerEnter(row);
      expect(screen.queryByRole('tooltip')).toBeNull();
      act(() => {
        jest.advanceTimersByTime(150);
      });
      const card = screen.getByRole('tooltip');
      expect(card).toHaveTextContent(LONG);
      expect(card).toHaveTextContent('unconnected');
      expect(card).toHaveTextContent('in · from');
      fireEvent.pointerLeave(row);
      expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('shows the net of a connected pin', () => {
      renderCanvas(layout);
      const rows = layout.nodes.flatMap((node) =>
        node.type === 'instance' ? [...node.data.west, ...node.data.east] : []
      );
      const row = rows.find(
        (candidate) =>
          candidate.netNames.length > 0 &&
          candidate.label === candidate.name &&
          rows.filter((other) => other.name === candidate.name).length === 1
      )!;
      fireEvent.pointerEnter(screen.getByText(row.name).parentElement!);
      act(() => {
        jest.advanceTimersByTime(150);
      });
      const card = screen.getByRole('tooltip');
      expect(card).toHaveTextContent(row.netNames[0]);
      expect(card).not.toHaveTextContent('unconnected');
    });

    it('closes when the layout changes', () => {
      const { rerender } = renderCanvas(layout);
      fireEvent.pointerEnter(screen.getByLabelText(LONG));
      act(() => {
        jest.advanceTimersByTime(150);
      });
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      rerender(canvas({ ...layout }));
      expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('does not open when the pointer leaves before the delay', () => {
      renderCanvas(layout);
      const row = screen.getByLabelText(LONG);
      fireEvent.pointerEnter(row);
      fireEvent.pointerLeave(row);
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('closes on Escape', () => {
      renderCanvas(layout);
      fireEvent.pointerEnter(screen.getByLabelText(LONG));
      act(() => {
        jest.advanceTimersByTime(150);
      });
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('tooltip')).toBeNull();
    });
  });
});
