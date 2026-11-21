import React from 'react';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { ResourceReport } from '../../../../domain/resourceUsage';
import { DiagramCanvas } from '../../../../webview/systemDiagram/DiagramCanvas';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { unconnectedPins } from '../../../../webview/systemDiagram/unconnectedPins';
import { stubCanvasSize } from './canvasSize';
import { clockContextOf } from './clockContext';
import { fakeMeasure } from './fixtureGraph';
import { vivadoGraph, vivadoReport } from './resources/resourceReports';

stubCanvasSize();

type Layout = Awaited<ReturnType<typeof layoutOf>>;

async function layoutOf(levelPath: string) {
  const laidOut = await runElkLayout(
    buildElkInput(vivadoGraph, levelPath, { measure: fakeMeasure })
  );
  return {
    levelPath,
    viewKey: levelPath,
    ...toFlowElements(laidOut, vivadoGraph, levelPath, fakeMeasure),
  };
}

function canvas(
  layout: Layout,
  extra: {
    resources?: ResourceReport;
    review?: boolean;
  }
) {
  return (
    <ReactFlowProvider>
      <DiagramCanvas
        layout={layout}
        error={null}
        selection={null}
        selectedNodeIds={[]}
        isolated={false}
        review={
          extra.review ? { graph: vivadoGraph, findings: unconnectedPins(vivadoGraph) } : null
        }
        clocks={clockContextOf(vivadoGraph, false, layout.levelPath)}
        resources={extra.resources}
        focusedPin={null}
        matcher={null}
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

describe('the canvas strip (Resources)', () => {
  let root: Layout;
  beforeAll(async () => {
    root = await layoutOf('/');
  }, 20000);

  const strip = (name: string) =>
    Array.from(
      (screen.getByText(name).closest('.sd-node-head')!.parentElement as HTMLElement).querySelector(
        '.sd-node-usage'
      )?.children ?? [],
      (line) => line.textContent
    );

  it('reads the counts on one line and the shares of the design and of the device on the next', async () => {
    render(canvas(root, { resources: vivadoReport }));
    await screen.findByText('axi_bram_ctrl_0');
    expect(strip('axi_bram_ctrl_0')).toEqual([
      '154 LUT · 168 FF · 0 BRAM · 0 DSP',
      '18.3 % design · 0.2 % device',
    ]);
  });

  it('has no strip without a report', async () => {
    const { rerender } = render(canvas(root, { resources: vivadoReport }));
    await screen.findByText('smartconnect_0');
    rerender(canvas(root, {}));
    expect(document.querySelectorAll('.sd-node-usage')).toHaveLength(0);
  });

  it('keeps the strips while the unconnected pins review is on', async () => {
    render(canvas(root, { resources: vivadoReport, review: true }));
    await screen.findByText('smartconnect_0');
    expect(document.querySelectorAll('.sd-node-usage').length).toBeGreaterThan(0);
  });
});
