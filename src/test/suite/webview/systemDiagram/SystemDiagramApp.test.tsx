import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SystemDiagramToWebviewMessage } from '../../../../shared/messages/systemDiagram';
import { SystemDiagramApp } from '../../../../webview/systemDiagram/SystemDiagramApp';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { nodeCenter } from '../../../../webview/systemDiagram/layout/nodeCenter';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { loadFixtureGraph } from './fixtureGraph';

const mockFitBounds = jest.fn<void, [unknown, unknown]>();
const mockSetCenter = jest.fn<void, [number, number, unknown]>();
const mockSetViewport = jest.fn<void, [unknown]>();
let mockViewport = { x: 0, y: 0, zoom: 1 };
const mockPostMessage = jest.fn<void, [unknown]>();

jest.mock('../../../../webview/vscode', () => ({
  vscode: { postMessage: (message: unknown) => mockPostMessage(message) },
}));

interface MockFlowNode {
  id: string;
  type: string;
  data: unknown;
  selected?: boolean;
}
interface MockFlowProps {
  nodes: MockFlowNode[];
  edges: unknown[];
  nodesDraggable: boolean;
  nodesConnectable: boolean;
  nodeTypes: Record<string, React.ComponentType<{ data: unknown; selected?: boolean }>>;
  onNodeClick: (event: unknown, node: MockFlowNode) => void;
  onNodeDoubleClick: (event: unknown, node: MockFlowNode) => void;
}

jest.mock('@xyflow/react', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const api = {
    // Like React Flow, a fit changes the viewport; the fitted zoom is 0.8.
    fitBounds: (bounds: unknown, options: unknown) => {
      mockViewport = { x: 0, y: 0, zoom: 0.8 };
      mockFitBounds(bounds, options);
    },
    setCenter: (x: number, y: number, options: unknown) => mockSetCenter(x, y, options),
    getViewport: () => mockViewport,
    setViewport: (viewport: { x: number; y: number; zoom: number }) => {
      mockViewport = viewport;
      mockSetViewport(viewport);
    },
    zoomIn: jest.fn(),
    zoomOut: jest.fn(),
  };
  return {
    Background: () => null,
    BackgroundVariant: { Dots: 'dots' },
    BaseEdge: () => null,
    Handle: () => null,
    Position: { Left: 'left', Right: 'right' },
    ReactFlow: (props: MockFlowProps) =>
      React.createElement(
        'div',
        {
          'data-testid': 'flow',
          'data-edges': String(props.edges.length),
          'data-read-only': String(!props.nodesDraggable && !props.nodesConnectable),
        },
        props.nodes.map((node) =>
          React.createElement(
            'div',
            { key: node.id },
            React.createElement(
              'button',
              {
                'data-testid': `node:${node.id}`,
                onClick: (event: unknown) => props.onNodeClick(event, node),
                onDoubleClick: (event: unknown) => props.onNodeDoubleClick(event, node),
              },
              node.id
            ),
            React.createElement(props.nodeTypes[node.type], {
              data: node.data,
              selected: node.selected,
            })
          )
        )
      ),
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
    useReactFlow: () => api,
  };
});

const graph = loadFixtureGraph();

function send(message: SystemDiagramToWebviewMessage): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
}

async function renderWithGraph() {
  render(<SystemDiagramApp />);
  send({ type: 'graph', graph });
  await waitFor(() => expect(screen.getByTestId('flow')).toBeInTheDocument());
  await screen.findByTestId('node:/axi_dma_0');
}

const outline = () => within(screen.getByRole('navigation', { name: 'Design outline' }));
const details = () => within(screen.getByRole('complementary', { name: 'Details' }));
const edgeCount = () => Number(screen.getByTestId('flow').getAttribute('data-edges'));

describe('SystemDiagramApp', () => {
  beforeEach(() => {
    mockViewport = { x: 0, y: 0, zoom: 1 };
  });

  it('announces readiness and renders the outline from a graph message', async () => {
    render(<SystemDiagramApp />);
    expect(mockPostMessage).toHaveBeenCalledWith({ type: 'ready' });
    send({ type: 'graph', graph });

    expect(await outline().findByRole('button', { name: 'axi_dma_0 axi_dma:7.1' })).toBeVisible();
    expect(outline().getByRole('button', { name: /^dsp_pipeline/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Offline view, partial/ })).toBeVisible();
    await screen.findByTestId('node:/axi_dma_0');
    expect(screen.getByTestId('flow')).toHaveAttribute('data-read-only', 'true');
  });

  it('shows the design summary first and instance details after selecting an outline row', async () => {
    await renderWithGraph();
    expect(details().getByText('zynq_dma_system')).toBeVisible();
    expect(details().getByText('Capabilities')).toBeVisible();

    fireEvent.click(outline().getByRole('button', { name: /^axi_dma_0/ }));

    expect(details().getByRole('heading', { name: 'axi_dma_0' })).toBeVisible();
    expect(details().getByText(/Only values set in the script are shown/)).toBeVisible();
    expect(details().getByText('CONFIG.c_include_sg')).toBeVisible();
  });

  it('enters a hierarchy, updates the breadcrumb and nodes, and goes back', async () => {
    await renderWithGraph();
    fireEvent.click(outline().getByRole('button', { name: /^dsp_pipeline/ }));
    fireEvent.click(details().getByRole('button', { name: 'Open hierarchy' }));

    const crumbs = within(screen.getByRole('navigation', { name: 'Hierarchy' }));
    await screen.findByTestId('node:/dsp_pipeline/axis_data_fifo_0');
    expect(crumbs.getByText('dsp_pipeline')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByTestId('node:/axi_dma_0')).not.toBeInTheDocument();

    fireEvent.click(crumbs.getByRole('button', { name: 'zynq_dma_system' }));
    await screen.findByTestId('node:/axi_dma_0');
    expect(screen.queryByTestId('node:/dsp_pipeline/axis_data_fifo_0')).not.toBeInTheDocument();
  });

  it('enters a hierarchy by double-clicking its node', async () => {
    await renderWithGraph();
    fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
    await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
  });

  it('navigates to the level of a nested outline row and selects it', async () => {
    await renderWithGraph();
    fireEvent.click(outline().getByRole('button', { name: 'Expand dsp_pipeline' }));
    fireEvent.click(outline().getByRole('button', { name: /^fir_compiler_0/ }));

    await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
    expect(details().getByRole('heading', { name: 'fir_compiler_0' })).toBeVisible();
  });

  it('adds clock and reset edges when the toggle is on', async () => {
    await renderWithGraph();
    const hidden = edgeCount();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clocks and resets' }));
    await waitFor(() => expect(edgeCount()).toBeGreaterThan(hidden));
  });

  it('posts revealSource from a line link', async () => {
    await renderWithGraph();
    fireEvent.click(outline().getByRole('button', { name: /^axi_dma_0/ }));
    const line = graph.instances['/axi_dma_0'].line;

    fireEvent.click(details().getByRole('button', { name: new RegExp(`:${line}$`) }));

    expect(mockPostMessage).toHaveBeenCalledWith({ type: 'revealSource', line });
  });

  it('selects the slave instance from an address map row', async () => {
    await renderWithGraph();
    const row = screen.getByText('axi_dma_0/S_AXI_LITE/Reg').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('0x4040FFFF')).toBeVisible();

    fireEvent.click(row!);

    expect(details().getByRole('heading', { name: 'axi_dma_0' })).toBeVisible();
  });

  it('lists problems from the badge', async () => {
    await renderWithGraph();
    fireEvent.click(screen.getByRole('button', { name: /Offline view, partial/ }));
    expect(screen.getByRole('tab', { name: /Problems/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Skipped Vivado-only commands/)).toBeVisible();
  });

  it('labels pins of hidden clock nets with a badge that selects the net', async () => {
    await renderWithGraph();
    const badges = screen.getAllByTitle(
      'Clock net processing_system7_0_FCLK_CLK0. Turn on Clocks and resets to draw it.'
    );
    expect(badges[0]).toHaveTextContent('processing_system7_0_FCL…');

    fireEvent.click(badges[0]);

    expect(
      details().getByRole('heading', { name: 'processing_system7_0_FCLK_CLK0' })
    ).toBeVisible();
    expect(details().getByText('Endpoints')).toBeVisible();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Clocks and resets' }));
    await waitFor(() =>
      expect(screen.queryAllByTitle(/Turn on Clocks and resets/)).toHaveLength(0)
    );
  });

  describe('revealing a selected component', () => {
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)));

    async function centerOf(level: string, nodeId: string) {
      const input = buildElkInput(graph, level, { showClockReset: false });
      const layout = toFlowElements(await runElkLayout(input), graph, level);
      return nodeCenter(layout, nodeId)!;
    }
    async function ready() {
      await renderWithGraph();
      await settle();
      mockFitBounds.mockClear();
      mockSetCenter.mockClear();
    }

    it('centres an outline selection on the same level at the current zoom, without fitting', async () => {
      await ready();
      mockViewport = { x: 5, y: 6, zoom: 1.7 };
      const center = await centerOf('/', '/axi_dma_0');

      fireEvent.click(outline().getByRole('button', { name: /^axi_dma_0/ }));

      await waitFor(() => expect(mockSetCenter).toHaveBeenCalledTimes(1));
      expect(mockSetCenter).toHaveBeenCalledWith(center.x, center.y, { zoom: 1.7 });
      expect(mockFitBounds).not.toHaveBeenCalled();
    });

    it('centres a boundary port selected in the outline', async () => {
      await ready();
      const center = await centerOf('/', '/::DDR');
      fireEvent.click(outline().getByRole('button', { name: /^DDR/ }));
      await waitFor(() => expect(mockSetCenter).toHaveBeenCalledTimes(1));
      expect(mockSetCenter.mock.calls[0].slice(0, 2)).toEqual([center.x, center.y]);
    });

    it('centres again when the same row is selected twice', async () => {
      await ready();
      const row = outline().getByRole('button', { name: /^axi_dma_0/ });
      fireEvent.click(row);
      await waitFor(() => expect(mockSetCenter).toHaveBeenCalledTimes(1));
      fireEvent.click(row);
      await waitFor(() => expect(mockSetCenter).toHaveBeenCalledTimes(2));
    });

    it('does not move the view for canvas clicks or net selections', async () => {
      await ready();
      fireEvent.click(screen.getByTestId('node:/axi_dma_0'));
      expect(details().getByRole('heading', { name: 'axi_dma_0' })).toBeVisible();
      fireEvent.click(screen.getAllByTitle(/Clock net processing_system7_0_FCLK_CLK0/)[0]);
      await settle();
      expect(mockSetCenter).not.toHaveBeenCalled();
    });

    it('centres the slave instance of an address map row', async () => {
      await ready();
      const center = await centerOf('/', '/axi_dma_0');
      fireEvent.click(screen.getByText('axi_dma_0/S_AXI_LITE/Reg').closest('tr')!);
      await waitFor(() => expect(mockSetCenter).toHaveBeenCalledTimes(1));
      expect(mockSetCenter.mock.calls[0].slice(0, 2)).toEqual([center.x, center.y]);
    });

    it('centres a pin-net endpoint link in the details panel', async () => {
      await ready();
      fireEvent.click(screen.getAllByTitle(/Clock net processing_system7_0_FCLK_CLK0/)[0]);
      mockSetCenter.mockClear();
      const link = details().getAllByRole('button', { name: /^\/axi_dma_0\// })[0];
      fireEvent.click(link);
      await waitFor(() => expect(mockSetCenter).toHaveBeenCalledTimes(1));
    });

    it('navigates, applies the fit, then centres with the fitted zoom on a first visit', async () => {
      await ready();
      mockViewport = { x: 0, y: 0, zoom: 1.3 }; // differs from the fitted zoom
      fireEvent.click(outline().getByRole('button', { name: 'Expand dsp_pipeline' }));
      fireEvent.click(outline().getByRole('button', { name: /^fir_compiler_0/ }));

      await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
      await waitFor(() => expect(mockSetCenter).toHaveBeenCalledTimes(1));
      const center = await centerOf('/dsp_pipeline', '/dsp_pipeline/fir_compiler_0');
      expect(mockFitBounds).toHaveBeenCalledTimes(1);
      expect(mockSetCenter).toHaveBeenCalledWith(center.x, center.y, { zoom: 0.8 });
    });

    it('centres with the restored zoom when the level has a saved viewport', async () => {
      await ready();
      fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
      await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
      await settle();
      mockViewport = { x: 1, y: 2, zoom: 0.55 };
      fireEvent.click(
        within(screen.getByRole('navigation', { name: 'Hierarchy' })).getByRole('button', {
          name: 'zynq_dma_system',
        })
      );
      await screen.findByTestId('node:/axi_dma_0');
      await settle();
      mockFitBounds.mockClear();
      mockSetCenter.mockClear();

      fireEvent.click(outline().getByRole('button', { name: 'Expand dsp_pipeline' }));
      fireEvent.click(outline().getByRole('button', { name: /^fir_compiler_0/ }));

      await waitFor(() => expect(mockSetCenter).toHaveBeenCalledTimes(1));
      expect(mockSetCenter.mock.calls[0][2]).toEqual({ zoom: 0.55 });
      expect(mockFitBounds).not.toHaveBeenCalled();
    });

    describe('dropping a superseded reveal request', () => {
      async function clickNestedRowThen(supersede: () => void) {
        await ready();
        fireEvent.click(outline().getByRole('button', { name: 'Expand dsp_pipeline' }));
        fireEvent.click(outline().getByRole('button', { name: /^fir_compiler_0/ }));
        supersede();
        await settle();
        await settle();
        expect(mockSetCenter).not.toHaveBeenCalled();

        // Entering the hierarchy later must not jump to the dropped target.
        await screen.findByTestId('node:/dsp_pipeline');
        fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
        await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
        await settle();
        await settle();
        expect(mockSetCenter).not.toHaveBeenCalled();
      }

      it('after navigating elsewhere (breadcrumb)', async () => {
        await clickNestedRowThen(() =>
          fireEvent.click(
            within(screen.getByRole('navigation', { name: 'Hierarchy' })).getByRole('button', {
              name: 'zynq_dma_system',
            })
          )
        );
      });

      it('after a canvas selection and a return through the outline design row', async () => {
        await ready();
        fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
        await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
        await settle();
        mockSetCenter.mockClear();

        // Queues a reveal for the root level; the root layout is still pending.
        fireEvent.click(outline().getByRole('button', { name: /^axi_dma_0/ }));
        // A plain canvas selection supersedes it and goes back to the dsp level.
        fireEvent.click(screen.getByTestId('node:/dsp_pipeline/fir_compiler_0'));
        // The design row changes level without going through navigate.
        fireEvent.click(outline().getByRole('button', { name: /^zynq_dma_system/ }));

        await screen.findByTestId('node:/axi_dma_0');
        await settle();
        await settle();
        expect(mockSetCenter).not.toHaveBeenCalled();
      });
    });
  });

  describe('per-level viewport', () => {
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    const rootView = { x: 40, y: 50, zoom: 1.5 };
    const dspView = { x: -5, y: 7, zoom: 0.6 };

    async function enterDsp() {
      fireEvent.click(outline().getByRole('button', { name: /^dsp_pipeline/ }));
      fireEvent.click(details().getByRole('button', { name: 'Open hierarchy' }));
      await screen.findByTestId('node:/dsp_pipeline/axis_data_fifo_0');
    }
    const goToRoot = async () => {
      fireEvent.click(
        within(screen.getByRole('navigation', { name: 'Hierarchy' })).getByRole('button', {
          name: 'zynq_dma_system',
        })
      );
      await screen.findByTestId('node:/axi_dma_0');
    };

    it('fits a level on first visit and restores saved viewports when returning', async () => {
      await renderWithGraph();
      await settle();
      mockViewport = rootView;
      mockFitBounds.mockClear();

      await enterDsp();
      await waitFor(() => expect(mockFitBounds).toHaveBeenCalledTimes(1));
      await settle();
      expect(mockSetViewport).not.toHaveBeenCalled();

      mockViewport = dspView;
      mockFitBounds.mockClear();
      await goToRoot();
      await waitFor(() => expect(mockSetViewport).toHaveBeenCalledWith(rootView));
      await settle();
      expect(mockFitBounds).not.toHaveBeenCalled();

      mockSetViewport.mockClear();
      mockViewport = rootView;
      await enterDsp();
      await waitFor(() => expect(mockSetViewport).toHaveBeenCalledWith(dspView));
      await settle();
      expect(mockFitBounds).not.toHaveBeenCalled();
    });

    it('keeps the viewport when Clocks and resets is toggled', async () => {
      await renderWithGraph();
      await settle();
      mockFitBounds.mockClear();
      const hidden = Number(screen.getByTestId('flow').getAttribute('data-edges'));

      fireEvent.click(screen.getByRole('checkbox', { name: 'Clocks and resets' }));
      await waitFor(() =>
        expect(Number(screen.getByTestId('flow').getAttribute('data-edges'))).toBeGreaterThan(
          hidden
        )
      );
      await settle();

      expect(mockFitBounds).not.toHaveBeenCalled();
      expect(mockSetViewport).not.toHaveBeenCalled();
    });

    it('keeps the viewport when the same level is re-posted', async () => {
      await renderWithGraph();
      await settle();
      mockFitBounds.mockClear();

      send({ type: 'graph', graph: JSON.parse(JSON.stringify(graph)) });
      await settle();
      await screen.findByTestId('node:/axi_dma_0');
      // The re-posted layout commits inside the first settle; give its
      // animation frame time to run before asserting nothing happened.
      await settle();

      expect(mockFitBounds).not.toHaveBeenCalled();
      expect(mockSetViewport).not.toHaveBeenCalled();
    });
  });

  describe('fitting', () => {
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)));

    it('fits the whole diagram after layout and from the Fit button', async () => {
      await renderWithGraph();
      await waitFor(() => expect(mockFitBounds).toHaveBeenCalled());
      const [bounds, options] = mockFitBounds.mock.calls[0];
      expect(bounds).toMatchObject({ x: expect.any(Number), width: expect.any(Number) });
      expect(options).toMatchObject({ padding: 0.1 });

      mockFitBounds.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
      expect(mockFitBounds).toHaveBeenCalledTimes(1);
    });

    it.each(['Toggle Outline', 'Toggle Details', 'Toggle Bottom Panel'])(
      'refits after %s changes the canvas size, but not after dragging a separator',
      async (title) => {
        await renderWithGraph();
        await settle();
        mockFitBounds.mockClear();

        fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize Outline' }), {
          key: 'ArrowRight',
        });
        await settle();
        expect(mockFitBounds).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: title }));
        await waitFor(() => expect(mockFitBounds).toHaveBeenCalledTimes(1));

        mockFitBounds.mockClear();
        fireEvent.click(screen.getByRole('button', { name: title }));
        await waitFor(() => expect(mockFitBounds).toHaveBeenCalledTimes(1));
      }
    );

    it('refits when a separator double-click collapses a panel', async () => {
      await renderWithGraph();
      await settle();
      mockFitBounds.mockClear();
      fireEvent.doubleClick(screen.getByRole('separator', { name: 'Resize Details' }));
      await waitFor(() => expect(mockFitBounds).toHaveBeenCalledTimes(1));
    });
  });

  describe('panel toggles', () => {
    const panels = [
      ['Toggle Outline', 'Resize Outline', 'ArrowRight', '276'],
      ['Toggle Details', 'Resize Details', 'ArrowRight', '304'],
      ['Toggle Bottom Panel', 'Resize Bottom Panel', 'ArrowUp', '216'],
    ] as const;

    beforeEach(() => {
      jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        right: 1600,
        top: 0,
        bottom: 900,
        width: 1600,
        height: 900,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
    });
    afterEach(() => jest.restoreAllMocks());

    it.each(panels)(
      '%s hides and restores the panel at its previous size',
      async (title, handle, key, size) => {
        await renderWithGraph();
        const toggle = screen.getByRole('button', { name: title });
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        fireEvent.keyDown(screen.getByRole('separator', { name: handle }), { key });

        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByRole('separator', { name: handle })).not.toBeInTheDocument();

        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('separator', { name: handle })).toHaveAttribute(
          'aria-valuenow',
          size
        );
      }
    );

    it('hides the outline, details, and bottom panels together and keeps the canvas', async () => {
      await renderWithGraph();
      for (const [title] of panels) {
        fireEvent.click(screen.getByRole('button', { name: title }));
      }
      expect(screen.queryByRole('navigation', { name: 'Design outline' })).not.toBeInTheDocument();
      expect(screen.queryByRole('complementary', { name: 'Details' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Bottom panel' })).not.toBeInTheDocument();
      expect(screen.getByTestId('flow')).toBeInTheDocument();
    });

    it('reopens the bottom panel on the problems tab from the badge', async () => {
      await renderWithGraph();
      fireEvent.click(screen.getByRole('button', { name: 'Toggle Bottom Panel' }));
      fireEvent.click(screen.getByRole('button', { name: /Offline view, partial/ }));
      expect(screen.getByRole('tab', { name: /Problems/ })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });
  });

  it('shows an empty state for scripts that are not block designs', () => {
    render(<SystemDiagramApp />);
    send({ type: 'notRecognized', fileName: 'build.tcl' });
    expect(screen.getByText('This Tcl file is not a Vivado block design script.')).toBeVisible();
  });

  it('shows read errors', () => {
    render(<SystemDiagramApp />);
    send({ type: 'error', message: 'boom' });
    expect(screen.getByText(/boom/)).toBeVisible();
  });
});
