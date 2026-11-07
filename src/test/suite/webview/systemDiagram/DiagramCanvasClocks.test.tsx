import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { DiagramCanvas } from '../../../../webview/systemDiagram/DiagramCanvas';
import { DiagramLegend } from '../../../../webview/systemDiagram/DiagramLegend';
import { ElkEdge } from '../../../../webview/systemDiagram/ElkEdge';
import { PinFrequency } from '../../../../webview/systemDiagram/PinDecor';
import { domainLegend } from '../../../../webview/systemDiagram/legend';
import type { DiagramFlowEdge } from '../../../../webview/systemDiagram/layout/elkLayout';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { clockContextOf } from './clockContext';
import { fakeMeasure, loadClockFixtureGraph, loadVersalClockGraph } from './fixtureGraph';

// Uses the real @xyflow/react, whose panels the app tests mock away: the banner and the
// legend of the domain mode, and how a wire and a pin frequency are drawn.
const graph = loadClockFixtureGraph();

async function layoutOf(levelPath: string, design = graph) {
  const laidOut = await runElkLayout(
    buildElkInput(design, levelPath, { showClockReset: true, measure: fakeMeasure })
  );
  return {
    levelPath,
    viewKey: levelPath,
    ...toFlowElements(laidOut, design, levelPath, fakeMeasure),
  };
}

function canvas(layout: Awaited<ReturnType<typeof layoutOf>>, domainMode: boolean, design = graph) {
  return (
    <ReactFlowProvider>
      <DiagramCanvas
        layout={layout}
        error={null}
        selection={null}
        selectedNodeIds={[]}
        isolated={false}
        review={null}
        clocks={clockContextOf(design, domainMode, layout.levelPath)}
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

describe('the canvas in the domain mode', () => {
  let root: Awaited<ReturnType<typeof layoutOf>>;
  let dsp: Awaited<ReturnType<typeof layoutOf>>;
  beforeAll(async () => {
    root = await layoutOf('/');
    dsp = await layoutOf('/dsp_pipeline');
  }, 20000);

  it('explains the level in a banner', async () => {
    render(canvas(root, true));
    const banner = await screen.findByLabelText('Clock domains');
    expect(banner).toHaveTextContent(
      'This level: ext_clk 125 MHz, FCLK_CLK0 100 MHz, FCLK_CLK1 200 MHz. 1 clock domain crossing without a synchronizer. 3 more inside nested hierarchies.'
    );
  });

  it('counts the crossings of the level shown', async () => {
    render(canvas(dsp, true));
    expect(await screen.findByLabelText('Clock domains')).toHaveTextContent(
      '1 clock domain crossing without a synchronizer. 2 resets released by another clock domain. axis_data_fifo_0 spans more than one domain.'
    );
  });

  it('lists a domain per entry, then the reset and crossing marks, in the legend', async () => {
    render(canvas(root, true));
    const legend = await screen.findByLabelText('Legend');
    for (const text of [
      'FCLK_CLK0 · 100 MHz',
      'FCLK_CLK1 · 200 MHz',
      'ext_clk · 125 MHz',
      'Reset, colored by the domain that releases it',
      'Clock or reset domain crossing',
    ]) {
      expect(within(legend).getByText(text)).toBeVisible();
    }
    const dashed = within(legend)
      .getByText('Clock or reset domain crossing')
      .querySelector('i.sd-legend-bar-dashed') as HTMLElement;
    expect(dashed.style.borderTopColor).toBe('var(--vscode-editorWarning-foreground)');
  });

  it('draws neither the banner nor the domain entries while off', async () => {
    render(canvas(root, false));
    await screen.findByText('axi_dma_0');
    expect(screen.queryByLabelText('Clock domains')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Legend')).not.toHaveTextContent('FCLK_CLK0');
  });

  it('draws the domain strips and frequency labels', async () => {
    render(canvas(root, true));
    await screen.findByText('axi_dma_0');
    expect(document.querySelectorAll('.sd-node-strip').length).toBeGreaterThan(0);
    const labels = [...document.querySelectorAll('.sd-pin-freq')].map((label) => label.textContent);
    expect(labels).toContain('125 MHz');
    expect(labels).toContain('200 MHz');
  });
});

describe('the canvas in the domain mode, on a design that sets no frequency', () => {
  const versal = loadVersalClockGraph();
  let root: Awaited<ReturnType<typeof layoutOf>>;
  beforeAll(async () => {
    root = await layoutOf('/', versal);
  }, 20000);

  it('names the domains of the level alone and mentions the related clocks apart', async () => {
    render(canvas(root, true, versal));
    expect(await screen.findByLabelText('Clock domains')).toHaveTextContent(
      'This level: clk_out1, clk_out2, pl0_ref_clk. 2 between related clocks.'
    );
  });

  it('lists the domains in the legend by name, with no frequency', async () => {
    render(canvas(root, true, versal));
    const legend = within(await screen.findByLabelText('Legend'));
    for (const name of ['clk_out1', 'clk_out2', 'pl0_ref_clk']) {
      expect(legend.getByText(name)).toBeVisible();
    }
    expect(screen.getByLabelText('Legend').textContent).not.toMatch(/unknown|Hz/i);
  });

  it('draws no frequency label and no word "unknown" on the canvas', async () => {
    render(canvas(root, true, versal));
    await screen.findByText('stream_src');
    expect(document.querySelectorAll('.sd-pin-freq')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/unknown|Hz/i);
    // The domain strips and pin colors stay.
    expect(document.querySelectorAll('.sd-node-strip').length).toBeGreaterThan(0);
  });
});

describe('DiagramLegend', () => {
  it('draws a dotted bar for the reset mark and a solid one for a domain', () => {
    render(
      <ReactFlowProvider>
        <DiagramLegend edges={[]} nodes={[]} review={false} domains={domainLegend([])} />
      </ReactFlowProvider>
    );
    const legend = screen.getByLabelText('Legend');
    expect(legend.querySelector('.sd-legend-bar-dotted')).not.toBeNull();
    expect(legend.querySelector('.sd-legend-bar-dashed')).not.toBeNull();
  });

  it('draws nothing without wires, review or domain entries', () => {
    render(
      <ReactFlowProvider>
        <DiagramLegend edges={[]} nodes={[]} review={false} />
      </ReactFlowProvider>
    );
    expect(screen.queryByLabelText('Legend')).toBeNull();
  });
});

describe('ElkEdge', () => {
  function drawn(data: Partial<DiagramFlowEdge['data']>, selected = false) {
    const props = {
      id: 'e',
      selected,
      data: {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        netId: 'n',
        category: 'clock',
        isInterface: false,
        ...data,
      },
    };
    const { container } = render(
      <svg>
        <ElkEdge {...(props as unknown as React.ComponentProps<typeof ElkEdge>)} />
      </svg>
    );
    return container.querySelector('path.react-flow__edge-path') as SVGPathElement;
  }

  it('keeps the category look without marks', () => {
    const path = drawn({});
    expect(path.style.stroke).toBe('var(--vscode-charts-orange)');
    expect(path.style.strokeDasharray).toBe('');
    expect(path.style.opacity).toBe('');
  });

  it('strokes in the domain color, dotted for a reset', () => {
    const path = drawn({ domainColor: 'var(--vscode-charts-purple)', dotted: true });
    expect(path.style.stroke).toBe('var(--vscode-charts-purple)');
    expect(path.style.strokeDasharray).toBe('2 3');
  });

  it('draws a crossing dashed in the warning color, over any domain color', () => {
    const path = drawn({ crossing: true, domainColor: 'red', category: 'axis' });
    expect(path.style.stroke).toBe('var(--vscode-editorWarning-foreground)');
    expect(path.style.strokeDasharray).toBe('6 4');
    expect(path.style.opacity).toBe('');
  });

  it('fades a dimmed wire unless it is selected', () => {
    expect(drawn({ dimmed: true }).style.opacity).toBe('0.2');
    expect(drawn({ dimmed: true }, true).style.opacity).toBe('');
  });
});

describe('PinFrequency', () => {
  it('sits above the wire on the east side, outside the block, in the domain color', () => {
    render(<PinFrequency text="100 MHz" color="red" side="east" />);
    const label = screen.getByText('100 MHz');
    expect(label.style.left).toBe('calc(100% + 8px)');
    expect(label.style.top).toBe('calc(50% - 2px)');
    expect(label.style.transform).toBe('translateY(-100%)');
    expect(label.style.color).toBe('red');
  });

  it('sits below the wire on the west side, so the two ends of a short wire do not overlap', () => {
    render(<PinFrequency text="200 MHz" side="west" top={16} />);
    const label = screen.getByText('200 MHz');
    expect(label.style.right).toBe('calc(100% + 8px)');
    expect(label.style.top).toBe('calc(18px)');
    expect(label.style.transform).toBe('');
  });

  it('moves below the wire on the east side when a net badge takes the place above', () => {
    render(<PinFrequency text="100 MHz" side="east" hasBadge />);
    expect(screen.getByText('100 MHz').style.top).toBe('calc(50% + 2px)');
  });
});
