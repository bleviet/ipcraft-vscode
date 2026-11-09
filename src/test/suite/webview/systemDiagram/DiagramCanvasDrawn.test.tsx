import React from 'react';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { DiagramCanvas } from '../../../../webview/systemDiagram/DiagramCanvas';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { isClockOrReset, type Selection } from '../../../../webview/systemDiagram/model';
import { clockContextOf } from './clockContext';
import { fakeMeasure, loadFixtureGraph } from './fixtureGraph';
import { stubCanvasSize } from './canvasSize';

stubCanvasSize();

// Uses the real @xyflow/react: what the canvas draws of one layout, whose clock and reset
// nets are badges and no wire, with the domain decorations of Clocks and resets on or off.
const graph = loadFixtureGraph();
const badges = () => [...document.querySelectorAll('.sd-badge')];

async function layoutOf() {
  const laidOut = await runElkLayout(buildElkInput(graph, '/', { measure: fakeMeasure }));
  return { levelPath: '/', viewKey: '/', ...toFlowElements(laidOut, graph, '/', fakeMeasure) };
}

function canvas(
  layout: Awaited<ReturnType<typeof layoutOf>>,
  domainMode: boolean,
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
        clocks={clockContextOf(graph, domainMode)}
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

describe('the canvas for one layout of clock and reset badges', () => {
  let layout: Awaited<ReturnType<typeof layoutOf>>;
  beforeAll(async () => {
    layout = await layoutOf();
  }, 20000);

  it('draws the badges of the clock and reset nets, with their wires, either way', async () => {
    const { rerender } = render(canvas(layout, false));
    await screen.findByText('axi_dma_0');
    const shown = badges().length;
    expect(shown).toBeGreaterThan(0);
    expect(layout.edges.some((edge) => isClockOrReset(edge.data))).toBe(true);

    rerender(canvas(layout, true));
    expect(badges()).toHaveLength(shown);
  });

  it('names the clock and reset categories in the legend either way', async () => {
    const { rerender } = render(canvas(layout, false));
    await screen.findByText('axi_dma_0');
    const off = legendLabels();
    expect(off).toEqual(expect.arrayContaining(['Clock', 'Reset', 'AXI4-Stream']));

    // The domain decorations append their entries after the categories.
    rerender(canvas(layout, true));
    expect(legendLabels().slice(0, off.length)).toEqual(off);
  });

  it('bolds the pins of a selected clock net by their badges, either way', async () => {
    const selection: Selection = { kind: 'net', id: '/::processing_system7_0_FCLK_CLK0' };
    const { rerender } = render(canvas(layout, false, selection));
    await screen.findByText('axi_dma_0');
    const byBadge = highlightedPins();
    expect(byBadge.length).toBeGreaterThan(5);

    rerender(canvas(layout, true, selection));
    expect(highlightedPins()).toEqual(byBadge);
  });
});
