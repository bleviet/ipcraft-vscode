import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { DiagramCanvas } from '../../../../webview/systemDiagram/DiagramCanvas';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import type { Selection } from '../../../../webview/systemDiagram/model';
import { clockContextOf } from './clockContext';
import { fakeMeasure, loadFixtureGraph } from './fixtureGraph';

// Uses the real @xyflow/react: what the canvas draws of one layout, which holds the clock and
// reset wires and badges alike, for each value of `drawClockReset`.
const graph = loadFixtureGraph();
const BADGES = /Turn on Clocks and resets to draw it/;

async function layoutOf() {
  const laidOut = await runElkLayout(buildElkInput(graph, '/', { measure: fakeMeasure }));
  return { levelPath: '/', viewKey: '/', ...toFlowElements(laidOut, graph, '/', fakeMeasure) };
}

function canvas(
  layout: Awaited<ReturnType<typeof layoutOf>>,
  drawClockReset: boolean,
  selection: Selection | null = null
) {
  return (
    <ReactFlowProvider>
      <DiagramCanvas
        layout={layout}
        error={null}
        selection={selection}
        selectedNodeIds={[]}
        isolated={false}
        review={null}
        clocks={clockContextOf(graph)}
        drawClockReset={drawClockReset}
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

const legendLabels = () =>
  [...screen.getByLabelText('Legend').querySelectorAll('.sd-legend-item')].map(
    (item) => item.textContent
  );
const highlightedPins = () =>
  [...document.querySelectorAll('.sd-node')]
    .flatMap((node) =>
      [...node.querySelectorAll('.sd-pin-label[data-highlight="true"]')].map(
        (pin) => `${node.querySelector('.sd-node-name')?.textContent}/${pin.textContent}`
      )
    )
    .sort();

describe('the canvas for one layout of clock and reset wires and badges', () => {
  let layout: Awaited<ReturnType<typeof layoutOf>>;
  beforeAll(async () => {
    layout = await layoutOf();
  }, 20000);

  it('draws the badges of the clock and reset nets while their wires are off', async () => {
    render(canvas(layout, false));
    await screen.findByText('axi_dma_0');
    expect(screen.getAllByTitle(BADGES).length).toBeGreaterThan(0);
  });

  it('draws no badge while the clock and reset wires are drawn', async () => {
    render(canvas(layout, true));
    await screen.findByText('axi_dma_0');
    expect(screen.queryAllByTitle(BADGES)).toHaveLength(0);
  });

  it('names the clock and reset categories in the legend either way', async () => {
    const { rerender } = render(canvas(layout, false));
    await screen.findByText('axi_dma_0');
    const off = legendLabels();
    expect(off).toEqual(expect.arrayContaining(['Clock', 'Reset', 'AXI4-Stream']));

    rerender(canvas(layout, true));
    expect(legendLabels()).toEqual(off);
  });

  it('bolds the pins of a selected clock net, by badge or by wire', async () => {
    const selection: Selection = { kind: 'net', id: '/::processing_system7_0_FCLK_CLK0' };
    const { rerender } = render(canvas(layout, false, selection));
    await screen.findByText('axi_dma_0');
    const byBadge = highlightedPins();
    expect(byBadge.length).toBeGreaterThan(5);

    rerender(canvas(layout, true, selection));
    expect(highlightedPins()).toEqual(byBadge);
    expect(within(document.body).queryAllByTitle(BADGES)).toHaveLength(0);
  });
});
