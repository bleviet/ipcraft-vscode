import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SystemDiagramToWebviewMessage } from '../../../../shared/messages/systemDiagram';
import { SystemDiagramApp } from '../../../../webview/systemDiagram/SystemDiagramApp';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { nodeCenter } from '../../../../webview/systemDiagram/layout/nodeCenter';
import { diagramBounds, nodeBounds } from '../../../../webview/systemDiagram/layout/diagramBounds';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { createTextMeasurer } from '../../../../webview/systemDiagram/layout/textMeasure';
import { searchMatches } from '../../../../webview/systemDiagram/search';
import {
  loadClockFixtureGraph,
  loadFixtureGraph,
  loadReviewFixtureGraph,
  loadVersalClockGraph,
} from './fixtureGraph';

const mockFitBounds = jest.fn<void, [unknown, unknown]>();
let mockElkFailures = 0;
const mockSetCenter = jest.fn<void, [number, number, unknown]>();
const mockSetViewport = jest.fn<void, [unknown]>();
let mockViewport = { x: 0, y: 0, zoom: 1 };
const mockPostMessage = jest.fn<void, [unknown]>();

jest.mock('../../../../webview/vscode', () => ({
  vscode: { postMessage: (message: unknown) => mockPostMessage(message) },
}));

jest.mock('../../../../webview/systemDiagram/layout/runElkLayout', () => {
  const actual = jest.requireActual<
    typeof import('../../../../webview/systemDiagram/layout/runElkLayout')
  >('../../../../webview/systemDiagram/layout/runElkLayout');
  return {
    runElkLayout: (input: Parameters<typeof actual.runElkLayout>[0]) => {
      if (mockElkFailures > 0) {
        mockElkFailures -= 1;
        return Promise.reject(new Error('elk failed'));
      }
      return actual.runElkLayout(input);
    },
  };
});

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
  onNodeContextMenu: (event: unknown, node: MockFlowNode) => void;
  onPaneContextMenu: (event: unknown) => void;
}

jest.mock('@xyflow/react', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const actualFlow = jest.requireActual<typeof import('@xyflow/react')>('@xyflow/react');
  const storeApi = {
    getState: () => ({ width: 1000, height: 800, minZoom: 0.05, maxZoom: 2 }),
  };
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
    Panel: () => null,
    Position: { Left: 'left', Right: 'right' },
    ReactFlow: (props: MockFlowProps) => {
      // Like React Flow's StoreUpdater, unmounting resets the viewport to the default.
      React.useEffect(
        () => () => {
          mockViewport = { x: 0, y: 0, zoom: 1 };
        },
        []
      );
      return React.createElement(
        'div',
        {
          'data-testid': 'flow',
          'data-edges': String(props.edges.length),
          'data-read-only': String(!props.nodesDraggable && !props.nodesConnectable),
        },
        React.createElement(
          'div',
          {
            className: 'react-flow__pane',
            'data-testid': 'pane',
            onContextMenu: (event: unknown) => props.onPaneContextMenu(event),
          },
          props.nodes.map((node) =>
            React.createElement(
              'div',
              { key: node.id, className: 'react-flow__node' },
              React.createElement(
                'button',
                {
                  'data-testid': `node:${node.id}`,
                  onClick: (event: unknown) => props.onNodeClick(event, node),
                  onDoubleClick: (event: unknown) => props.onNodeDoubleClick(event, node),
                  onContextMenu: (event: { stopPropagation: () => void }) => {
                    // Like React Flow, a node's context menu does not reach the pane.
                    event.stopPropagation();
                    props.onNodeContextMenu(event, node);
                  },
                },
                node.id
              ),
              React.createElement(props.nodeTypes[node.type], {
                data: node.data,
                selected: node.selected,
              })
            )
          )
        )
      );
    },
    getViewportForBounds: actualFlow.getViewportForBounds,
    useStoreApi: () => storeApi,
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

const PANEL_TOGGLES = ['Toggle Outline', 'Toggle Details', 'Toggle Bottom Panel'];

/** The panels start hidden; open them through the real toolbar toggles. */
function openPanels(): void {
  for (const name of PANEL_TOGGLES) {
    fireEvent.click(screen.getByRole('button', { name }));
  }
}

/**
 * Renders the app with a graph; `panelsOpen: false` keeps the initial hidden panels.
 * `ready` is the node whose presence says the level is drawn.
 */
async function renderWithGraph({
  panelsOpen = true,
  design = graph,
  ready = '/axi_dma_0',
}: { panelsOpen?: boolean; design?: typeof graph; ready?: string } = {}) {
  render(<SystemDiagramApp />);
  send({ type: 'graph', graph: design });
  await waitFor(() => expect(screen.getByTestId('flow')).toBeInTheDocument());
  await screen.findByTestId(`node:${ready}`);
  if (panelsOpen) {
    openPanels();
  }
}

const outline = () => within(screen.getByRole('navigation', { name: 'Design outline' }));
const details = () => within(screen.getByRole('complementary', { name: 'Details' }));
const edgeCount = () => Number(screen.getByTestId('flow').getAttribute('data-edges'));

// jsdom has no canvas; the app and these tests share the length-based fallback.
const appMeasure = createTextMeasurer('sans-serif');

describe('SystemDiagramApp', () => {
  beforeEach(() => {
    mockElkFailures = 0;
    mockViewport = { x: 0, y: 0, zoom: 1 };
  });

  it('announces readiness and renders the outline from a graph message', async () => {
    render(<SystemDiagramApp />);
    expect(mockPostMessage).toHaveBeenCalledWith({ type: 'ready' });
    send({ type: 'graph', graph });
    await screen.findByTestId('node:/axi_dma_0');
    openPanels();

    expect(await outline().findByRole('button', { name: 'axi_dma_0 axi_dma:7.1' })).toBeVisible();
    expect(outline().getByRole('button', { name: /^dsp_pipeline/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /^\d+ problems?$/ })).toBeVisible();
    await screen.findByTestId('node:/axi_dma_0');
    expect(screen.getByTestId('flow')).toHaveAttribute('data-read-only', 'true');
  });

  it('shows the design summary first and instance details after selecting an outline row', async () => {
    await renderWithGraph();
    expect(details().getByText('zynq_dma_system')).toBeVisible();
    expect(details().getByText('What this view knows')).toBeVisible();

    fireEvent.click(outline().getByRole('button', { name: /^axi_dma_0/ }));

    expect(details().getByRole('heading', { name: 'axi_dma_0' })).toBeVisible();
    expect(details().getByText(/Only values set in the design file are shown/)).toBeVisible();
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

  describe('expanding a hierarchy block in place', () => {
    const crumbs = () => within(screen.getByRole('navigation', { name: 'Hierarchy' }));
    const expandToggle = () => screen.getByRole('button', { name: 'Expand dsp_pipeline in place' });

    it('draws the inner level inside the block and collapses it again, staying on the level', async () => {
      await renderWithGraph();
      expect(screen.queryByTestId('node:/dsp_pipeline/fir_compiler_0')).not.toBeInTheDocument();

      fireEvent.click(expandToggle());
      await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
      expect(screen.getByTestId('node:/axi_dma_0')).toBeInTheDocument();
      expect(crumbs().getByText('zynq_dma_system')).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('button', { name: 'Collapse dsp_pipeline' })).toHaveAttribute(
        'aria-expanded',
        'true'
      );

      fireEvent.click(screen.getByRole('button', { name: 'Collapse dsp_pipeline' }));
      await waitFor(() =>
        expect(screen.queryByTestId('node:/dsp_pipeline/fir_compiler_0')).not.toBeInTheDocument()
      );
      expect(expandToggle()).toBeInTheDocument();
    });

    it('selects a block inside without leaving the level', async () => {
      await renderWithGraph();
      fireEvent.click(expandToggle());
      fireEvent.click(await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0'));

      expect(details().getByRole('heading', { name: 'fir_compiler_0' })).toBeVisible();
      expect(crumbs().getByText('zynq_dma_system')).toHaveAttribute('aria-current', 'page');
      expect(screen.getByTestId('node:/axi_dma_0')).toBeInTheDocument();
    });

    it('keeps the block expanded when entering it and coming back', async () => {
      await renderWithGraph();
      fireEvent.click(expandToggle());
      await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');

      fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
      await waitFor(() =>
        expect(crumbs().getByText('dsp_pipeline')).toHaveAttribute('aria-current', 'page')
      );
      await waitFor(() => expect(screen.queryByTestId('node:/axi_dma_0')).not.toBeInTheDocument());
      expect(screen.getByTestId('node:/dsp_pipeline/fir_compiler_0')).toBeInTheDocument();

      fireEvent.click(crumbs().getByRole('button', { name: 'zynq_dma_system' }));
      await screen.findByTestId('node:/axi_dma_0');
      expect(await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Collapse dsp_pipeline' })).toBeInTheDocument();
    });
  });

  describe('mouse back button', () => {
    const crumbs = () => within(screen.getByRole('navigation', { name: 'Hierarchy' }));

    it('goes up one level and keeps going one at a time', async () => {
      await renderWithGraph();
      fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
      await screen.findByTestId('node:/dsp_pipeline/coeff_bank');
      fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline/coeff_bank'));
      await screen.findByText('coeff_bank', { selector: '[aria-current="page"]' });

      fireEvent.mouseUp(window, { button: 3 });
      await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
      expect(crumbs().getByText('dsp_pipeline')).toHaveAttribute('aria-current', 'page');

      fireEvent.mouseUp(window, { button: 3 });
      await screen.findByTestId('node:/axi_dma_0');
      expect(screen.queryByTestId('node:/dsp_pipeline/fir_compiler_0')).not.toBeInTheDocument();
    });

    it('does nothing at the root', async () => {
      await renderWithGraph();
      fireEvent.mouseUp(window, { button: 3 });
      expect(screen.getByTestId('node:/axi_dma_0')).toBeInTheDocument();
      expect(screen.getByTestId('node:/dsp_pipeline')).toBeInTheDocument();
    });

    it.each([0, 4])('ignores button %i', async (button) => {
      await renderWithGraph();
      fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
      await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
      fireEvent.mouseUp(window, { button });
      expect(screen.getByTestId('node:/dsp_pipeline/fir_compiler_0')).toBeInTheDocument();
      expect(crumbs().getByText('dsp_pipeline')).toHaveAttribute('aria-current', 'page');
    });
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

  it('posts openDefinition from the Defined by link of an enriched instance', async () => {
    render(<SystemDiagramApp />);
    const enriched = JSON.parse(JSON.stringify(graph)) as typeof graph;
    enriched.instances['/axi_dma_0'].definition = {
      kind: 'ip.yml',
      file: '/ws/ip/axi_dma.ip.yml',
      uri: 'file:///ws/ip/axi_dma.ip.yml',
      displayName: 'ip/axi_dma.ip.yml',
    };
    send({ type: 'graph', graph: enriched });
    await screen.findByTestId('node:/axi_dma_0');
    openPanels();
    fireEvent.click(outline().getByRole('button', { name: /^axi_dma_0/ }));

    fireEvent.click(details().getByRole('button', { name: 'ip/axi_dma.ip.yml' }));

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'openDefinition',
      instance: '/axi_dma_0',
    });
    expect(details().getByTitle('Open ip/axi_dma.ip.yml')).toBeVisible();
  });

  it('selects the slave instance from an address map row', async () => {
    await renderWithGraph();
    const row = screen.getByText('axi_dma_0/S_AXI_LITE/Reg').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('0x4040_FFFF')).toBeVisible();

    fireEvent.click(row!);

    expect(details().getByRole('heading', { name: 'axi_dma_0' })).toBeVisible();
  });

  it('starts with the outline, details, and bottom panels hidden', async () => {
    await renderWithGraph({ panelsOpen: false });
    expect(screen.queryByRole('navigation', { name: 'Design outline' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Bottom panel' })).not.toBeInTheDocument();
    for (const name of PANEL_TOGGLES) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
    expect(screen.getByTestId('flow')).toBeInTheDocument();
  });

  it('lists problems from the badge', async () => {
    await renderWithGraph({ panelsOpen: false });
    fireEvent.click(screen.getByRole('button', { name: /^\d+ problems?$/ }));
    expect(screen.getByRole('tab', { name: /Problems/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Skipped Vivado-only commands/)).toBeVisible();
  });

  it('counts the problems on the badge and hides it when there are none', async () => {
    await renderWithGraph({ panelsOpen: false });
    expect(graph.diagnostics.length).toBeGreaterThan(1);
    expect(
      screen.getByRole('button', { name: `${graph.diagnostics.length} problems` })
    ).toBeVisible();
    cleanup();
    await renderWithGraph({ panelsOpen: false, design: { ...graph, diagnostics: [] } });
    expect(screen.queryByRole('button', { name: /^\d+ problems?$/ })).not.toBeInTheDocument();
  });

  it('labels pins of hidden clock nets with a badge that selects the net', async () => {
    await renderWithGraph();
    const badges = screen.getAllByTitle(
      'Clock net processing_system7_0_FCLK_CLK0. Turn on Clocks and resets to draw it.'
    );
    expect(badges[0]).toHaveTextContent('FCLK_CLK0');

    fireEvent.click(badges[0]);

    expect(
      details().getByRole('heading', { name: 'processing_system7_0_FCLK_CLK0' })
    ).toBeVisible();
    // A clock net opens its clock tree.
    expect(details().getByText(/^Clock net · domain/)).toBeVisible();
    expect(details().getByText('Requested by', { exact: false })).toBeVisible();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Clocks and resets' }));
    await waitFor(() =>
      expect(screen.queryAllByTitle(/Turn on Clocks and resets/)).toHaveLength(0)
    );
  });

  it('lists the endpoints of a data net in the details', async () => {
    await renderWithGraph();
    fireEvent.click(outline().getByRole('button', { name: /^axi_dma_0/ }));
    fireEvent.click(details().getByRole('button', { name: 'axi_dma_0_M_AXIS_MM2S' }));

    expect(details().getByRole('heading', { name: 'axi_dma_0_M_AXIS_MM2S' })).toBeVisible();
    expect(details().getByText('Endpoints')).toBeVisible();
    expect(details().getByRole('button', { name: '/axi_dma_0/M_AXIS_MM2S' })).toBeVisible();
  });

  describe('search stepping', () => {
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    const searchBox = () => screen.getByRole('searchbox', { name: 'Search instances' });
    const matches = searchMatches(graph, 'axi');
    const last = matches.length - 1;

    async function search(query: string) {
      await renderWithGraph();
      await settle();
      fireEvent.change(searchBox(), { target: { value: query } });
    }
    const press = (init: { key: string; shiftKey?: boolean }) =>
      fireEvent.keyDown(searchBox(), init);
    const enter = () => press({ key: 'Enter' });

    it('counts the matches over all levels', async () => {
      await search('axi');
      expect(screen.getByText(`${matches.length} matches`)).toBeVisible();
      expect(matches.some((path) => path.startsWith('/dsp_pipeline/'))).toBe(true);
    });

    it('selects the first match on Enter and shows its position', async () => {
      await search('axi');
      enter();
      expect(await screen.findByText(`1 of ${matches.length}`)).toBeVisible();
      expect(
        details().getByRole('heading', { name: graph.instances[matches[0]].name })
      ).toBeVisible();
    });

    it('reaches a match inside the hierarchy and switches the level', async () => {
      await search('fifo');
      enter();
      const nav = () => screen.getByRole('navigation', { name: 'Hierarchy' });
      await waitFor(() => expect(within(nav()).getByText('dsp_pipeline')).toBeVisible());
      expect(await screen.findByText('1 of 2')).toBeVisible();
      enter();
      await waitFor(() => expect(within(nav()).getByText('coeff_bank')).toBeVisible());
      expect(await screen.findByText('2 of 2')).toBeVisible();
    });

    it('wraps to the last match on Shift+Enter from the first', async () => {
      await search('axi');
      enter();
      await screen.findByText(`1 of ${matches.length}`);
      press({ key: 'Enter', shiftKey: true });
      expect(await screen.findByText(`${last + 1} of ${matches.length}`)).toBeVisible();
    });

    it('clears the query and the counter on Escape', async () => {
      await search('axi');
      searchBox().focus();
      press({ key: 'Escape' });
      expect(searchBox()).toHaveValue('');
      expect(searchBox()).not.toHaveFocus();
      expect(screen.queryByText(`${matches.length} matches`)).not.toBeInTheDocument();
    });

    it('does nothing on Enter without results', async () => {
      await search('zzzz');
      expect(screen.getByText('No results')).toBeVisible();
      enter();
      expect(screen.getByText('No results')).toBeVisible();
      expect(mockSetCenter).not.toHaveBeenCalled();
    });

    it('pulses the stepped-to node', async () => {
      await search('dma');
      enter();
      await waitFor(() =>
        expect(
          screen.getByTestId('node:/axi_dma_0').parentElement?.querySelector('.sd-flash')
        ).not.toBeNull()
      );
      expect(
        screen.getByTestId('node:/axi_gpio_0').parentElement?.querySelector('.sd-flash')
      ).toBeNull();
    });

    const flashOf = (id: string) =>
      screen.getByTestId(`node:${id}`).parentElement?.querySelector('.sd-flash') ?? null;

    it('restarts the pulse when the same single match is stepped to again', async () => {
      await search('dma');
      expect(searchMatches(graph, 'dma')).toHaveLength(1);
      enter();
      await waitFor(() => expect(flashOf('/axi_dma_0')).not.toBeNull());
      const first = flashOf('/axi_dma_0');
      enter();
      await waitFor(() => expect(flashOf('/axi_dma_0')).not.toBe(first));
      expect(flashOf('/axi_dma_0')).not.toBeNull();
    });

    it('does not replay the pulse after it ended and the level is re-entered', async () => {
      await search('fifo');
      enter();
      await waitFor(() => expect(flashOf('/dsp_pipeline/axis_data_fifo_0')).not.toBeNull());
      fireEvent.animationEnd(flashOf('/dsp_pipeline/axis_data_fifo_0')!);
      expect(flashOf('/dsp_pipeline/axis_data_fifo_0')).toBeNull();

      const nav = screen.getByRole('navigation', { name: 'Hierarchy' });
      fireEvent.click(within(nav).getByRole('button', { name: graph.name }));
      fireEvent.doubleClick(await screen.findByTestId('node:/dsp_pipeline'));
      await screen.findByTestId('node:/dsp_pipeline/axis_data_fifo_0');
      expect(flashOf('/dsp_pipeline/axis_data_fifo_0')).toBeNull();
    });

    it('drops a pending pulse when Escape clears the search', async () => {
      await search('dma');
      enter();
      await waitFor(() => expect(flashOf('/axi_dma_0')).not.toBeNull());
      press({ key: 'Escape' });
      await waitFor(() => expect(flashOf('/axi_dma_0')).toBeNull());
    });

    it('zooms in to a readable size at low zoom, but never zooms out', async () => {
      await search('dma');
      mockViewport = { x: 0, y: 0, zoom: 0.3 };
      mockSetCenter.mockClear();
      enter();
      await waitFor(() => expect(mockSetCenter).toHaveBeenCalledTimes(1));
      const zoom = (mockSetCenter.mock.calls[0][2] as { zoom: number }).zoom;
      expect(zoom).toBeGreaterThan(0.3);
      expect(zoom).toBeLessThanOrEqual(0.8);

      mockViewport = { x: 0, y: 0, zoom: 1.7 };
      mockSetCenter.mockClear();
      press({ key: 'Enter', shiftKey: true });
      await waitFor(() => expect(mockSetCenter).toHaveBeenCalledTimes(1));
      expect(mockSetCenter.mock.calls[0][2]).toEqual({ zoom: 1.7 });
    });
  });

  describe('revealing a selected component', () => {
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)));

    async function centerOf(level: string, nodeId: string) {
      const input = buildElkInput(graph, level, { showClockReset: false, measure: appMeasure });
      const layout = toFlowElements(await runElkLayout(input), graph, level, appMeasure);
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
      // A canvas click selects without centring, so the one centring below is the link's.
      fireEvent.click(screen.getByTestId('node:/axi_dma_0'));
      fireEvent.click(details().getByRole('button', { name: 'axi_dma_0_M_AXIS_MM2S' }));
      mockSetCenter.mockClear();
      const link = details().getAllByRole('button', { name: /^\/axi_dma_0\// })[0];
      fireEvent.click(link);
      await waitFor(() => expect(mockSetCenter).toHaveBeenCalledTimes(1));
    });

    it('centres a block linked from a clock tree in the details panel', async () => {
      await ready();
      fireEvent.click(screen.getAllByTitle(/Clock net processing_system7_0_FCLK_CLK0/)[0]);
      mockSetCenter.mockClear();
      const link = details().getAllByRole('button', { name: /^axi_dma_0\// })[0];
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

  describe('transient bad edits', () => {
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    const clone = () => JSON.parse(JSON.stringify(graph)) as typeof graph;
    const crumbs = () => within(screen.getByRole('navigation', { name: 'Hierarchy' }));

    async function enterDspAndCollapseOutline() {
      await renderWithGraph();
      await settle();
      fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
      await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Toggle Outline' }));
      await settle(); // let the panel-resize refit run
      mockFitBounds.mockClear();
      mockSetViewport.mockClear();
    }

    const bad: [string, SystemDiagramToWebviewMessage, RegExp][] = [
      [
        'an error',
        { type: 'error', message: 'boom' },
        /The design could not be read: boom\. Showing the last valid version\./,
      ],
      [
        'an error whose message ends with a period',
        { type: 'error', message: 'boom.' },
        /The design could not be read: boom\. Showing the last valid version\./,
      ],
      [
        'a file that is no longer recognized',
        { type: 'notRecognized', fileName: 'x.tcl' },
        /This file is no longer recognized as a Vivado block design script or Platform Designer system\. Showing the last valid version\./,
      ],
    ];

    it.each(bad)(
      'keeps the workbench and its state after %s, then recovers silently',
      async (_name, message, banner) => {
        await enterDspAndCollapseOutline();

        send(message);
        expect(await screen.findByRole('status')).toHaveTextContent(banner);
        expect(crumbs().getByText('dsp_pipeline')).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'Toggle Outline' })).toHaveAttribute(
          'aria-pressed',
          'false'
        );
        expect(screen.getByRole('button', { name: 'Toggle Details' })).toHaveAttribute(
          'aria-pressed',
          'true'
        );
        expect(screen.getByTestId('node:/dsp_pipeline/fir_compiler_0')).toBeInTheDocument();

        send({ type: 'graph', graph: clone() });
        await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
        await settle();
        expect(crumbs().getByText('dsp_pipeline')).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'Toggle Outline' })).toHaveAttribute(
          'aria-pressed',
          'false'
        );
        expect(screen.getByRole('button', { name: 'Toggle Details' })).toHaveAttribute(
          'aria-pressed',
          'true'
        );
        expect(mockFitBounds).not.toHaveBeenCalled();
        expect(mockSetViewport).not.toHaveBeenCalled();
      }
    );

    it('shows the empty states when the first message is not a graph', () => {
      const { unmount } = render(<SystemDiagramApp />);
      send({ type: 'error', message: 'boom' });
      expect(screen.getByText(/Could not read the design: boom/)).toBeVisible();
      unmount();
      render(<SystemDiagramApp />);
      send({ type: 'notRecognized', fileName: 'x.tcl' });
      expect(
        screen.getByText(
          'This file is not a Vivado block design script or Platform Designer system.'
        )
      ).toBeVisible();
    });

    /** The fixture without the dsp_pipeline hierarchy. */
    function withoutDspPipeline() {
      const pruned = clone();
      for (const path of Object.keys(pruned.instances)) {
        if (path.startsWith('/dsp_pipeline')) {
          delete pruned.instances[path];
        }
      }
      delete pruned.levels['/dsp_pipeline'];
      delete pruned.levels['/dsp_pipeline/coeff_bank'];
      pruned.levels['/'].instances = pruned.levels['/'].instances.filter(
        (path) => path !== '/dsp_pipeline'
      );
      return pruned;
    }

    it('goes to the root when a re-posted graph no longer has the current level', async () => {
      await renderWithGraph();
      await settle();
      const rootView = { x: 40, y: 50, zoom: 1.5 };
      mockViewport = rootView;
      fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
      await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
      await settle();
      mockSetViewport.mockClear();

      send({ type: 'graph', graph: withoutDspPipeline() });

      await screen.findByTestId('node:/axi_dma_0');
      expect(crumbs().getByText('zynq_dma_system')).toHaveAttribute('aria-current', 'page');
      await waitFor(() => expect(mockSetViewport).toHaveBeenCalledWith(rootView));

      // The move to the root is stored: a graph that has the level again (an undo) stays there.
      send({ type: 'graph', graph: clone() });
      await screen.findByTestId('node:/dsp_pipeline');
      await settle();
      expect(crumbs().getByText('zynq_dma_system')).toHaveAttribute('aria-current', 'page');
      expect(screen.queryByTestId('node:/dsp_pipeline/fir_compiler_0')).not.toBeInTheDocument();
    });

    it('drops a pending reveal whose level vanished before its layout finished', async () => {
      await renderWithGraph();
      await settle();
      mockSetCenter.mockClear();

      // Queues a reveal for the dsp level; its layout is still pending.
      fireEvent.click(outline().getByRole('button', { name: 'Expand dsp_pipeline' }));
      fireEvent.click(outline().getByRole('button', { name: /^fir_compiler_0/ }));
      send({ type: 'graph', graph: withoutDspPipeline() });
      await settle();
      send({ type: 'graph', graph: clone() });
      await screen.findByTestId('node:/dsp_pipeline');
      await settle();
      expect(crumbs().getByText('zynq_dma_system')).toHaveAttribute('aria-current', 'page');

      // Entering the level later does not replay the dropped reveal.
      fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
      await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
      await settle();
      await settle();
      expect(mockSetCenter).not.toHaveBeenCalled();
    });

    it('clears the selection when a re-posted graph no longer has the selected instance', async () => {
      await renderWithGraph();
      fireEvent.click(outline().getByRole('button', { name: /^axi_dma_0/ }));
      expect(details().getByRole('heading', { name: 'axi_dma_0' })).toBeVisible();

      const pruned = clone();
      delete pruned.instances['/axi_dma_0'];
      pruned.levels['/'].instances = pruned.levels['/'].instances.filter(
        (path) => path !== '/axi_dma_0'
      );
      send({ type: 'graph', graph: pruned });

      await waitFor(() =>
        expect(details().queryByRole('heading', { name: 'axi_dma_0' })).not.toBeInTheDocument()
      );
      expect(details().getByText('What this view knows')).toBeVisible();

      // The selection is really cleared, not just hidden: it does not come back.
      send({ type: 'graph', graph: clone() });
      await screen.findByTestId('node:/axi_dma_0');
      await settle();
      expect(details().queryByRole('heading', { name: 'axi_dma_0' })).not.toBeInTheDocument();
    });
  });

  describe('after a layout error', () => {
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    const repost = () => send({ type: 'graph', graph: JSON.parse(JSON.stringify(graph)) });

    it('keeps the canvas mounted while the error is shown', async () => {
      await renderWithGraph();
      mockElkFailures = 1;
      repost();
      expect(await screen.findByRole('alert')).toHaveTextContent('Layout failed: elk failed');
      expect(screen.getByTestId('flow')).toBeInTheDocument();
    });

    it('restores the pre-error view when the same level recovers', async () => {
      await renderWithGraph();
      await settle();
      const before = { x: 11, y: 22, zoom: 1.4 };
      mockViewport = before;
      mockFitBounds.mockClear();
      mockSetViewport.mockClear();

      mockElkFailures = 1;
      repost();
      await screen.findByText(/Layout failed: elk failed/);
      repost();
      await screen.findByTestId('node:/axi_dma_0');
      await settle();

      expect(mockSetViewport).toHaveBeenCalledWith(before);
      expect(mockFitBounds).not.toHaveBeenCalled();
    });

    it("does not overwrite the previous level's saved view when navigation fails", async () => {
      await renderWithGraph();
      await settle();
      const rootView = { x: 40, y: 50, zoom: 1.5 };
      mockViewport = rootView;

      mockElkFailures = 1;
      fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
      await screen.findByText(/Layout failed: elk failed/);
      repost();
      await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
      await settle();
      mockSetViewport.mockClear();

      fireEvent.click(
        within(screen.getByRole('navigation', { name: 'Hierarchy' })).getByRole('button', {
          name: 'zynq_dma_system',
        })
      );
      await screen.findByTestId('node:/axi_dma_0');
      await waitFor(() => expect(mockSetViewport).toHaveBeenCalledWith(rootView));
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

    async function levelLayout() {
      const input = buildElkInput(graph, '/', { showClockReset: false, measure: appMeasure });
      return toFlowElements(await runElkLayout(input), graph, '/', appMeasure);
    }

    it.each(['/axi_dma_0', '/::DDR'])('zooms to %s by double-clicking it', async (id) => {
      await renderWithGraph();
      await settle();
      const layout = await levelLayout();
      mockFitBounds.mockClear();

      fireEvent.doubleClick(screen.getByTestId(`node:${id}`));

      expect(mockFitBounds).toHaveBeenCalledTimes(1);
      expect(mockFitBounds.mock.calls[0]).toEqual([
        nodeBounds(layout.nodes.find((node) => node.id === id)!),
        { padding: 0.25 },
      ]);
    });

    it('opens a hierarchy on double-click without zooming to it', async () => {
      await renderWithGraph();
      await settle();
      mockFitBounds.mockClear();
      fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
      await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
      expect(mockFitBounds).not.toHaveBeenCalledWith(expect.anything(), { padding: 0.25 });
    });

    it('fits the level when the empty canvas is double-clicked', async () => {
      await renderWithGraph();
      await settle();
      const layout = await levelLayout();
      mockFitBounds.mockClear();

      fireEvent.doubleClick(screen.getByTestId('pane'));

      expect(mockFitBounds).toHaveBeenCalledTimes(1);
      expect(mockFitBounds.mock.calls[0]).toEqual([diagramBounds(layout), { padding: 0.1 }]);
    });

    it('fits the whole diagram after layout and from the Fit button', async () => {
      // Panels stay hidden: opening one refits, which would mask the first-load fit.
      await renderWithGraph({ panelsOpen: false });
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

  describe('isolating blocks', () => {
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    const node = (id: string) => screen.getByTestId(`node:${id}`);
    const nodeIds = () =>
      screen
        .queryAllByTestId(/^node:/)
        .map((element) => element.getAttribute('data-testid')!.slice(5))
        .sort();
    const ISOLATED = [
      '/::leds_4bits',
      '/axi_dma_0',
      '/axi_gpio_0',
      '/axi_mem_intercon',
      '/dsp_pipeline',
      '/ps7_0_axi_periph',
      '/xlconcat_0',
    ];
    const chip = () => screen.queryByText(/^Isolated · /);

    async function selectTwo() {
      await renderWithGraph();
      await settle();
      fireEvent.click(node('/axi_gpio_0'));
      fireEvent.click(node('/axi_dma_0'), { ctrlKey: true });
    }
    async function isolateTwo() {
      await selectTwo();
      fireEvent.contextMenu(node('/axi_dma_0'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Isolate 2 Selected' }));
      await waitFor(() => expect(nodeIds()).toEqual(ISOLATED));
    }

    it('adds a node to the selection with Ctrl+Click and lists it in Details', async () => {
      await selectTwo();
      expect(details().getByRole('heading', { name: '2 selected' })).toBeVisible();
      expect(details().getByRole('button', { name: 'axi_dma_0' })).toBeVisible();
      fireEvent.click(details().getByRole('button', { name: 'axi_gpio_0' }));
      expect(details().getByRole('heading', { name: 'axi_gpio_0' })).toBeVisible();
      fireEvent.click(node('/axi_dma_0'), { metaKey: true });
      expect(details().getByRole('heading', { name: '2 selected' })).toBeVisible();
      fireEvent.click(node('/axi_gpio_0'), { metaKey: true });
      expect(details().getByRole('heading', { name: 'axi_dma_0' })).toBeVisible();
    });

    it('isolates the selection with its connections and the chip, then shows all', async () => {
      await isolateTwo();
      expect(chip()).toHaveTextContent('Isolated · 2 selected · 7 shown');
      fireEvent.click(screen.getByRole('button', { name: 'Show All' }));
      await waitFor(() => expect(nodeIds().length).toBeGreaterThan(ISOLATED.length));
      expect(chip()).toBeNull();
    });

    it('isolates a right-clicked node outside the selection alone', async () => {
      await selectTwo();
      fireEvent.contextMenu(node('/pulse_gen_0'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Isolate Selection' }));
      await waitFor(() =>
        expect(nodeIds()).toEqual(['/::ext_trigger', '/::trigger_pulse', '/pulse_gen_0'])
      );
    });

    it('shows all from the pane menu, where Show All is disabled when not isolated', async () => {
      await renderWithGraph();
      await settle();
      fireEvent.contextMenu(screen.getByTestId('pane'));
      expect(screen.getByRole('menuitem', { name: 'Show All' })).toHaveAttribute(
        'aria-disabled',
        'true'
      );
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();

      fireEvent.click(node('/pulse_gen_0'));
      fireEvent.contextMenu(node('/pulse_gen_0'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Isolate Selection' }));
      await waitFor(() => expect(nodeIds()).toHaveLength(3));
      fireEvent.contextMenu(screen.getByTestId('pane'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Show All' }));
      await waitFor(() => expect(nodeIds().length).toBeGreaterThan(3));
      expect(chip()).toBeNull();
    });

    it('operates the menu from the keyboard', async () => {
      await renderWithGraph();
      await settle();
      fireEvent.contextMenu(node('/pulse_gen_0'));
      const menu = screen.getByRole('menu');
      expect(menu).toHaveFocus();
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      fireEvent.keyDown(menu, { key: 'ArrowUp' });
      fireEvent.keyDown(menu, { key: 'Enter' });
      expect(screen.queryByRole('menu')).toBeNull();
      await waitFor(() => expect(nodeIds()).toHaveLength(3));
    });

    it('ends isolation when entering a hierarchy', async () => {
      await isolateTwo();
      fireEvent.doubleClick(node('/dsp_pipeline'));
      await screen.findByTestId('node:/dsp_pipeline/axis_data_fifo_0');
      expect(chip()).toBeNull();
    });

    it('ends isolation when a search step reaches a hidden node, then reveals it', async () => {
      await isolateTwo();
      await settle();
      const input = buildElkInput(graph, '/', { showClockReset: false, measure: appMeasure });
      const pulseCentre = nodeCenter(
        toFlowElements(await runElkLayout(input), graph, '/', appMeasure),
        '/pulse_gen_0'
      )!;
      mockSetCenter.mockClear();
      mockSetViewport.mockClear();
      fireEvent.change(screen.getByLabelText('Search instances'), { target: { value: 'pulse' } });
      fireEvent.keyDown(screen.getByLabelText('Search instances'), { key: 'Enter' });
      await screen.findByTestId('node:/pulse_gen_0');
      expect(chip()).toBeNull();
      await waitFor(() => expect(mockSetCenter).toHaveBeenCalledTimes(1));
      // The reveal waits for the full layout, so it centres after the restore.
      expect(mockSetViewport).toHaveBeenCalledTimes(1);
      expect(mockSetCenter.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockSetViewport.mock.invocationCallOrder[0]
      );
      expect(mockSetCenter).toHaveBeenCalledWith(pulseCentre.x, pulseCentre.y, expect.anything());
      expect(details().getByRole('heading', { name: 'pulse_gen_0' })).toBeVisible();
    });

    it('fits on isolating and restores the previous viewport on Show All', async () => {
      await renderWithGraph();
      await settle();
      const before = { x: 40, y: 50, zoom: 1.5 };
      mockViewport = before;
      mockFitBounds.mockClear();
      mockSetViewport.mockClear();
      fireEvent.click(node('/pulse_gen_0'));
      fireEvent.contextMenu(node('/pulse_gen_0'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Isolate Selection' }));
      await waitFor(() => expect(mockFitBounds).toHaveBeenCalledTimes(1));
      await settle();
      expect(mockSetViewport).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Show All' }));
      await waitFor(() => expect(mockSetViewport).toHaveBeenCalledWith(before));
      expect(mockFitBounds).toHaveBeenCalledTimes(1);
    });
  });

  describe('unconnected pins review', () => {
    const bank = '/dsp_pipeline/coeff_bank';
    const reviewGraph = loadReviewFixtureGraph();
    const bottom = () => within(screen.getByRole('region', { name: 'Bottom panel' }));
    const rowOf = (pin: string, block: string) =>
      bottom()
        .getAllByText(pin)
        .map((cell) => cell.closest('tr'))
        .find((row) => row !== null && within(row).queryByText(block) !== null)!;
    async function review() {
      await renderWithGraph({ design: reviewGraph });
      fireEvent.click(screen.getByRole('button', { name: /^Unconnected pins/ }));
    }

    it('turns on from the toolbar, opens the Unconnected tab, and lists the pins', async () => {
      await review();
      expect(screen.getByRole('button', { name: /^Unconnected pins/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByRole('tab', { name: /^Unconnected 6$/ })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(rowOf('spare_in', 'axi_gpio_0')).toBeDefined();
      expect(rowOf('ext_out', 'external port')).toBeDefined();
      expect(rowOf('cfg_open', 'coeff_bank (hierarchy pin)')).toBeDefined();
      expect(bottom().getByText(/Not checked: 11 blocks/)).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: /^Unconnected pins/ }));
      expect(screen.getByRole('button', { name: /^Unconnected pins/ })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });

    it('hides rows of a class when its filter chip is turned off', async () => {
      await review();
      fireEvent.click(bottom().getByRole('button', { name: /^Unused/ }));
      expect(bottom().queryByText('spare_out')).not.toBeInTheDocument();
      expect(bottom().getByText('spare_in')).toBeVisible();
      fireEvent.click(bottom().getByRole('button', { name: /^Undriven/ }));
      expect(bottom().queryByText('spare_in')).not.toBeInTheDocument();
    });

    it('selects the block of a clicked row', async () => {
      await review();
      fireEvent.click(rowOf('spare_in', 'axi_gpio_0'));
      expect(details().getByRole('heading', { name: 'axi_gpio_0' })).toBeVisible();
      expect(rowOf('spare_in', 'axi_gpio_0')).toHaveClass('sd-row-selected');
    });

    it('zooms in to the block of a clicked row at low zoom, but never zooms out', async () => {
      const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)));
      await review();
      await settle();
      mockSetCenter.mockClear();
      mockViewport = { x: 0, y: 0, zoom: 0.3 };
      fireEvent.click(rowOf('spare_in', 'axi_gpio_0'));
      await waitFor(() => expect(mockSetCenter).toHaveBeenCalledTimes(1));
      const zoom = (mockSetCenter.mock.calls[0][2] as { zoom: number }).zoom;
      expect(zoom).toBeGreaterThan(0.3);
      expect(zoom).toBeLessThanOrEqual(0.8);

      mockViewport = { x: 0, y: 0, zoom: 1.7 };
      mockSetCenter.mockClear();
      fireEvent.click(rowOf('spare_out', 'axi_gpio_0'));
      await waitFor(() => expect(mockSetCenter).toHaveBeenCalledTimes(1));
      expect(mockSetCenter.mock.calls[0][2]).toEqual({ zoom: 1.7 });
    });

    it('switches level for a pin of a nested hierarchy', async () => {
      await review();
      fireEvent.click(rowOf('cfg_open', 'coeff_bank (hierarchy pin)'));
      await screen.findByTestId(`node:${bank}::cfg_open`);
      expect(details().getByRole('heading', { name: 'cfg_open' })).toBeVisible();
      expect(details().getByText('Nothing on this level uses this port.')).toBeVisible();
      const crumbs = within(screen.getByRole('navigation', { name: 'Hierarchy' }));
      expect(crumbs.getByText('coeff_bank')).toHaveAttribute('aria-current', 'page');
    });

    const nodeBox = (id: string, selector: string) =>
      screen.getByTestId(`node:${id}`).parentElement!.querySelector(selector) as HTMLElement;
    const stubs = (id: string, cls: string) =>
      screen
        .getByTestId(`node:${id}`)
        .parentElement!.querySelectorAll(`.sd-pin-stub[data-class="${cls}"]`);

    it('shows a compact count badge only while the review is on', async () => {
      await renderWithGraph({ design: reviewGraph });
      const label = '3 unconnected pins (1 undriven, 2 unused)';
      expect(screen.queryByRole('img', { name: label })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Unconnected pins/ }));
      const badge = within(nodeBox('/axi_gpio_0', '.sd-node')).getByRole('img', { name: label });
      expect(badge).toHaveAttribute('title', label);
      expect(badge).toHaveTextContent('3');
      expect(badge.querySelector('.codicon-warning')).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /^Unconnected pins/ }));
      expect(screen.queryByRole('img', { name: label })).not.toBeInTheDocument();
    });

    it('marks nodes and unconnected rows with the review attributes and stubs', async () => {
      await renderWithGraph({ design: reviewGraph });
      expect(
        screen.getByTestId('node:/axi_gpio_0').parentElement!.querySelector('.sd-pin-stub')
      ).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /^Unconnected pins/ }));
      const gpio = nodeBox('/axi_gpio_0', '.sd-node');
      expect(gpio).toHaveAttribute('data-has-unc', 'true');
      expect(gpio).toHaveAttribute('data-has-undriven', 'true');
      expect(gpio).toHaveAttribute('data-unchecked', 'false');
      expect(stubs('/axi_gpio_0', 'undriven')).toHaveLength(1);
      expect(stubs('/axi_gpio_0', 'unused')).toHaveLength(2);
      const dma = nodeBox('/axi_dma_0', '.sd-node');
      expect(dma).toHaveAttribute('data-has-unc', 'false');
      expect(dma).toHaveAttribute('data-unchecked', 'true');
      const port = nodeBox('/::ext_out', '.sd-port');
      expect(port).toHaveAttribute('data-has-undriven', 'true');
      expect(stubs('/::ext_out', 'undriven')).toHaveLength(1);
    });

    it('counts findings on outline rows while the review is on', async () => {
      await renderWithGraph({ design: reviewGraph });
      expect(outline().queryByTitle('1 undriven, 2 unused')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Unconnected pins/ }));
      expect(
        within(outline().getByRole('button', { name: /^axi_gpio_0/ })).getByTitle(
          '1 undriven, 2 unused'
        )
      ).toHaveTextContent('3');
      expect(
        within(outline().getByRole('button', { name: /^dsp_pipeline/ })).getByTitle(
          '1 undriven, 1 unused'
        )
      ).toHaveTextContent('2');
      expect(
        within(outline().getByRole('button', { name: /^ext_out/ })).getByTitle(
          '1 undriven, 0 unused'
        )
      ).toHaveTextContent('1');
      expect(
        within(outline().getByRole('button', { name: /^zynq_dma_system/ })).getByTitle(
          '3 undriven, 3 unused'
        )
      ).toHaveTextContent('6');
    });

    it('haloes the focused pin only while its node is the primary selection', async () => {
      await review();
      const halos = (id: string) =>
        screen.getByTestId(`node:${id}`).parentElement!.querySelectorAll('.sd-pin-halo');
      expect(halos('/axi_gpio_0')).toHaveLength(0);
      fireEvent.click(rowOf('spare_in', 'axi_gpio_0'));
      expect(halos('/axi_gpio_0')).toHaveLength(1);
      fireEvent.click(screen.getByTestId('node:/axi_dma_0'));
      expect(halos('/axi_gpio_0')).toHaveLength(0);
    });

    it('expands a collapsed bottom panel when turned on and leaves the tab when turned off', async () => {
      await renderWithGraph({ design: reviewGraph, panelsOpen: false });
      expect(screen.queryByRole('region', { name: 'Bottom panel' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Unconnected pins/ }));
      expect(screen.getByRole('tab', { name: /^Unconnected/ })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      fireEvent.click(screen.getByRole('tab', { name: /^Problems/ }));
      fireEvent.click(screen.getByRole('button', { name: /^Unconnected pins/ }));
      expect(screen.getByRole('tab', { name: /^Problems/ })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });

    it('tags unconnected pins in the instance details without the review on', async () => {
      await renderWithGraph({ design: reviewGraph });
      fireEvent.click(outline().getByRole('button', { name: /^axi_gpio_0/ }));
      expect(details().getByText('undriven')).toHaveAttribute(
        'title',
        'Unconnected: no net drives this pin'
      );
      expect(details().getAllByText('unused')).toHaveLength(2);
      expect(details().getByText(/ties an input without a driver/)).toBeVisible();
      fireEvent.click(outline().getByRole('button', { name: /^axi_dma_0/ }));
      expect(details().getByText(/unconnected pins cannot be checked/)).toBeVisible();
    });
  });

  describe('clock domains', () => {
    const DSP = '/dsp_pipeline';
    const clockGraph = loadClockFixtureGraph();
    const bottom = () => within(screen.getByRole('region', { name: 'Bottom panel' }));
    const toggle = () => screen.getByRole('button', { name: /^Clock domains/ });
    const nodeBox = (id: string, selector: string) =>
      screen.getByTestId(`node:${id}`).parentElement!.querySelector(selector) as HTMLElement;
    // A domain or reset row, by its first cell.
    const rowOf = (text: string) =>
      bottom()
        .getAllByRole('row')
        .find((row) => within(row).queryAllByRole('cell')[0]?.textContent?.trim() === text)!;
    const openResets = () => fireEvent.click(screen.getByRole('tab', { name: /^Resets/ }));
    async function domains() {
      await renderWithGraph({ design: clockGraph });
      fireEvent.click(toggle());
    }

    it('turns on from the toolbar, opens the Clocks tab, and counts the crossings', async () => {
      await renderWithGraph({ design: clockGraph });
      expect(toggle()).toHaveAttribute('aria-pressed', 'false');
      expect(toggle()).toHaveTextContent('2 CDC · 2 RDC');
      fireEvent.click(toggle());
      expect(toggle()).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('tab', { name: /^Clocks 3$/ })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      fireEvent.click(toggle());
      expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    });

    it('lists a reset tied to a constant as such, with its one sink checked ok', async () => {
      await renderWithGraph();
      fireEvent.click(toggle());
      openResets();
      // The reset lives in dsp_pipeline/coeff_bank: the tab lists it once that level is on screen.
      expect(bottom().queryByText('tie_valid/dout')).not.toBeInTheDocument();
      fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
      await screen.findByTestId('node:/dsp_pipeline/coeff_bank');
      fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline/coeff_bank'));
      await screen.findByTestId('node:/dsp_pipeline/coeff_bank/tie_valid');
      const row = rowOf('tie_valid/dout');
      const cells = within(row).getAllByRole('cell');
      expect(cells[1]).toHaveTextContent('tied to a constant');
      expect(cells[2]).toHaveTextContent('xlconstant, tied to a constant');
      expect(cells[3]).toHaveTextContent('1');
      fireEvent.click(row);
      expect(details().getByText(/^Reset net · tied to a constant/)).toBeVisible();
      expect(
        details().getByText('is tied to a constant and never toggles.', { exact: false })
      ).toBeVisible();
      expect(details().getByText('✓ tied to a constant')).toBeVisible();
      expect(details().getByText('None found.')).toBeVisible();
    });

    it('counts the domains when no crossing is flagged', async () => {
      await renderWithGraph();
      expect(toggle()).toHaveTextContent(/Clock domains\s*1$/);
    });

    it('is exclusive with the unconnected pin review', async () => {
      await domains();
      const review = () => screen.getByRole('button', { name: /^Unconnected pins/ });
      fireEvent.click(review());
      expect(review()).toHaveAttribute('aria-pressed', 'true');
      expect(toggle()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('tab', { name: /^Unconnected/ })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      fireEvent.click(toggle());
      expect(toggle()).toHaveAttribute('aria-pressed', 'true');
      expect(review()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('tab', { name: /^Clocks/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('draws clocks and resets while on and disables the checkbox', async () => {
      await renderWithGraph({ design: clockGraph });
      const checkbox = screen.getByRole('checkbox', { name: 'Clocks and resets' });
      const before = edgeCount();
      expect(checkbox).toBeEnabled();
      fireEvent.click(toggle());
      expect(checkbox).toBeDisabled();
      expect(checkbox).toHaveAttribute('title', 'Clock domains mode draws clocks and resets');
      await waitFor(() => expect(edgeCount()).toBeGreaterThan(before));
      fireEvent.click(toggle());
      expect(checkbox).toBeEnabled();
      await waitFor(() => expect(edgeCount()).toBe(before));
    });

    it('lists the domains in the Clocks tab', async () => {
      await domains();
      const fclk0 = rowOf('FCLK_CLK0');
      const cells = within(fclk0).getAllByRole('cell');
      expect(cells[1]).toHaveTextContent('100 MHz');
      expect(cells[2]).toHaveTextContent('processing_system7_0/FCLK_CLK0');
      expect(cells[3]).toHaveTextContent('CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ = 100');
      expect(cells[3]).toHaveTextContent('script');
      expect(cells[4]).toHaveTextContent('8');
      expect(cells[5]).toHaveTextContent('2');
      expect(within(rowOf('ext_clk')).getAllByRole('cell')[3]).toHaveTextContent('declared');
      expect(bottom().queryByText('processing_system7_0/FCLK_RESET0_N')).not.toBeInTheDocument();
    });

    it('lists the reset sources in the Resets tab', async () => {
      await domains();
      openResets();
      expect(screen.getByRole('tab', { name: 'Resets 3' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(bottom().getByRole('heading', { name: 'Reset sources' })).toBeVisible();
      expect(bottom().queryByText('FCLK_CLK0')).not.toBeInTheDocument();
      const asynchronous = rowOf('processing_system7_0/FCLK_RESET0_N');
      expect(within(asynchronous).getAllByRole('cell')[1]).toHaveTextContent('asynchronous');
      const released = rowOf('rst_ps7_0_100M/peripheral_aresetn');
      expect(within(released).getAllByRole('cell')[1]).toHaveTextContent('FCLK_CLK0 · 100 MHz');
      expect(within(released).getAllByRole('cell')[3]).toHaveTextContent('6');
    });

    it('opens the clock tree of a clicked domain row', async () => {
      await domains();
      fireEvent.click(rowOf('FCLK_CLK1'));
      expect(
        details().getByRole('heading', { name: 'processing_system7_0_FCLK_CLK1' })
      ).toBeVisible();
      expect(details().getByText(/^Clock net · domain/)).toHaveTextContent('FCLK_CLK1');
      expect(details().getByText('200 MHz')).toBeVisible();
      expect(details().getByText('CONFIG.PCW_FPGA1_PERIPHERAL_FREQMHZ')).toBeVisible();
      expect(details().getByText(/This is the requested value/)).toBeVisible();
      expect(details().getByText('Clock tree · 3 loads in 2 levels')).toBeVisible();
      expect(details().getByText('SELECTED')).toBeVisible();
      expect(details().getByRole('button', { name: 'fir_compiler_0/aclk' })).toBeVisible();
      expect(details().getByText('enters hierarchy')).toBeVisible();
      expect(
        details().getByText('No reset is synchronized to FCLK_CLK1', { exact: false })
      ).toBeVisible();
      expect(details().getByText('Blocks also on another domain:', { exact: false })).toBeVisible();
      expect(rowOf('FCLK_CLK1')).toHaveClass('sd-row-selected');
    });

    it('shows the crossings of a domain with a link to the net', async () => {
      await domains();
      fireEvent.click(rowOf('FCLK_CLK0'));
      expect(details().getAllByText('Clock domain crossing.')).toHaveLength(2);
      const showNet = details().getAllByRole('button', { name: 'Show net' })[0];
      fireEvent.click(showNet);
      expect(details().getByText('Clock domain crossing.', { exact: false })).toBeVisible();
    });

    it('opens the reset tree with a check per sink and the fix hint', async () => {
      await domains();
      openResets();
      fireEvent.click(rowOf('rst_ps7_0_100M/peripheral_aresetn'));
      expect(details().getByText(/^Reset net · released on/)).toHaveTextContent('FCLK_CLK0');
      expect(details().getByText('Reset tree · 6 sinks')).toBeVisible();
      expect(details().getAllByText('✓ FCLK_CLK0').length).toBeGreaterThan(0);
      expect(details().getAllByText('✗ clocked by FCLK_CLK1 · 200 MHz')).toHaveLength(2);
      expect(details().getByText('? clock unknown')).toBeVisible();
      expect(details().getAllByText('Reset domain crossing.')).toHaveLength(2);
      expect(
        details().getByText(/Give the blocks on FCLK_CLK1 · 200 MHz their own proc_sys_reset/)
      ).toBeVisible();
    });

    it('checks the frequency a definition expects against the domain, in the clock tree', async () => {
      const edited = JSON.parse(JSON.stringify(clockGraph)) as typeof clockGraph;
      const pin = (path: string, name: string) =>
        edited.instances[path].pins.find((candidate) => candidate.name === name)!;
      pin(`${DSP}/fir_compiler_0`, 'aclk').frequency = '200MHz';
      pin(`${DSP}/ovf_monitor_0`, 'clk').frequency = '100MHz';
      await renderWithGraph({ design: edited });
      fireEvent.click(toggle());
      fireEvent.click(rowOf('FCLK_CLK1'));
      expect(details().getByText('✓ .ip.yml expects 200MHz')).toBeVisible();
      expect(details().getByText('✗ .ip.yml expects 100MHz')).toBeVisible();
    });

    it('opens an asynchronous reset with its provenance', async () => {
      await domains();
      openResets();
      fireEvent.click(rowOf('processing_system7_0/FCLK_RESET0_N'));
      expect(details().getByText(/^Reset net · asynchronous/)).toBeVisible();
      expect(
        details().getByText('is asserted and released asynchronously.', { exact: false })
      ).toBeVisible();
      expect(details().getByText('✓ asynchronous input')).toBeVisible();
      expect(details().getByText('None found.')).toBeVisible();
    });

    // The rows of the crossings table of the open tab, header row excluded.
    const crossingRows = () =>
      within(bottom().getByRole('columnheader', { name: 'Problem' }).closest('table')!)
        .getAllByRole('row')
        .slice(1);
    const showUnchecked = (count: number) =>
      bottom().getByRole('checkbox', { name: `Show ${count} that could not be checked` });

    it('lists only the data crossings without a synchronizer in the Clocks tab, with one line and no status chips', async () => {
      await domains();
      expect(bottom().getByRole('heading', { name: 'Clock domain crossings' })).toBeVisible();
      expect(bottom().getByText('1 crossing without a synchronizer.')).toBeVisible();
      expect(crossingRows()).toHaveLength(1);
      expect(bottom().queryByText('fir_compiler_0/aresetn')).not.toBeInTheDocument();
      expect(bottom().queryByText(/has clocks on 2 domains/)).not.toBeInTheDocument();
      expect(bottom().queryByText('Both ends on FCLK_CLK0')).not.toBeInTheDocument();
      expect(bottom().queryByText('axis_data_fifo_0 (dsp_pipeline)')).not.toBeInTheDocument();
      expect(bottom().queryByText(/Checked: memory-mapped/)).not.toBeInTheDocument();
      for (const chip of [/^Crossing/, /^Related clocks/, /^Block spans/, /^Not checked/, /^OK/]) {
        expect(bottom().queryByRole('button', { name: chip })).not.toBeInTheDocument();
      }
    });

    it('lists only the reset crossings in the Resets tab, with their own line and no Kind column', async () => {
      await domains();
      openResets();
      expect(bottom().getByRole('heading', { name: 'Reset domain crossings' })).toBeVisible();
      expect(bottom().getByText('2 reset crossings without a synchronizer.')).toBeVisible();
      expect(crossingRows()).toHaveLength(2);
      expect(bottom().queryByText('fir_compiler_0/M_AXIS_DATA')).not.toBeInTheDocument();
      expect(
        within(bottom().getByRole('columnheader', { name: 'Problem' }).closest('tr')!)
          .getAllByRole('columnheader')
          .map((header) => header.textContent)
      ).toEqual(['Status', 'From', 'To', 'Problem', 'Source']);
    });

    it('shows the data crossings that could not be checked on request, and hides them again', async () => {
      await domains();
      expect(showUnchecked(1)).not.toBeChecked();
      fireEvent.click(showUnchecked(1));
      expect(showUnchecked(1)).toBeChecked();
      expect(crossingRows()).toHaveLength(2);
      expect(bottom().getByText('1 crossing without a synchronizer.')).toBeVisible();
      const unchecked = bottom()
        .getAllByText(/has clocks on 2 domains/)[0]
        .closest('tr')!;
      expect(
        within(unchecked.firstElementChild as HTMLElement).getByRole('img', {
          name: 'Could not be checked',
        })
      ).toHaveTextContent('?');
      fireEvent.click(showUnchecked(1));
      expect(crossingRows()).toHaveLength(1);
      expect(bottom().queryByText(/has clocks on 2 domains/)).not.toBeInTheDocument();
    });

    it('shows the reset crossings that could not be checked on their own checkbox', async () => {
      await domains();
      openResets();
      expect(showUnchecked(1)).not.toBeChecked();
      fireEvent.click(showUnchecked(1));
      expect(crossingRows()).toHaveLength(3);
      expect(bottom().getByText('2 reset crossings without a synchronizer.')).toBeVisible();
      expect(bottom().getByText(/axis_data_fifo_0 has clocks on 2 domains/)).toBeVisible();
      fireEvent.click(showUnchecked(1));
      expect(crossingRows()).toHaveLength(2);
    });

    it('describes a data crossing: kind, both ends, the problem, and how the clocks were determined', async () => {
      await domains();
      const row = bottom().getByText('fir_compiler_0/M_AXIS_DATA').closest('tr')!;
      const cells = within(row).getAllByRole('cell');
      expect(within(cells[0]).getByRole('img', { name: 'Crossing' })).toHaveTextContent('!');
      expect(cells[1]).toHaveTextContent('AXI4-Stream');
      expect(cells[2]).toHaveTextContent('fir_compiler_0/M_AXIS_DATA');
      expect(cells[3]).toHaveTextContent('axi_dma_0/S_AXIS_S2MM');
      expect(cells[4]).toHaveTextContent('200 MHz to 100 MHz, no synchronizer');
      expect(row).toHaveAttribute(
        'title',
        'fir_compiler_0/M_AXIS_DATA: FCLK_CLK1 · 200 MHz, known from single clock\n' +
          'axi_dma_0/S_AXIS_S2MM: FCLK_CLK0 · 100 MHz, known from all clocks one domain'
      );
      expect(
        within(bottom().getByRole('columnheader', { name: 'Problem' }).closest('tr')!)
          .getAllByRole('columnheader')
          .map((header) => header.textContent)
      ).toEqual(['Status', 'Kind', 'From', 'To', 'Problem', 'Source']);
    });

    it('describes a reset crossing: both ends, the problem, and how the clocks were determined', async () => {
      await domains();
      openResets();
      const reset = bottom().getByText('fir_compiler_0/aresetn').closest('tr')!;
      const cells = within(reset).getAllByRole('cell');
      expect(within(cells[0]).getByRole('img', { name: 'Crossing' })).toHaveTextContent('!');
      expect(cells[1]).toHaveTextContent('rst_ps7_0_100M/peripheral_aresetn');
      expect(cells[2]).toHaveTextContent('fir_compiler_0/aresetn');
      expect(cells[3]).toHaveTextContent(
        'released by FCLK_CLK0 · 100 MHz, clocked by FCLK_CLK1 · 200 MHz'
      );
      expect(reset.getAttribute('title')).toContain(
        'rst_ps7_0_100M/peripheral_aresetn: FCLK_CLK0 · 100 MHz, known from proc_sys_reset slowest_sync_clk'
      );
    });

    describe('lists what the level on screen shows', () => {
      const tabCount = (name: string, count: number) =>
        screen.getByRole('tab', { name: `${name} ${count}` });
      const has = (text: string) => bottom().queryByText(text) !== null;
      const crumbs = () => within(screen.getByRole('navigation', { name: 'Hierarchy' }));

      it('changes the Clocks tab when entering dsp_pipeline and back', async () => {
        await domains();
        expect(tabCount('Clocks', 3)).toHaveAttribute('aria-selected', 'true');
        expect(bottom().getByText('1 crossing without a synchronizer.')).toBeVisible();
        expect(rowOf('ext_clk')).toBeDefined();
        expect(has('fir_ctrl_0/M_AXIS_CONFIG')).toBe(false);
        expect(has('fir_compiler_0/M_AXIS_DATA')).toBe(true);

        fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
        await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
        expect(tabCount('Clocks', 2)).toHaveAttribute('aria-selected', 'true');
        expect(bottom().getByText('2 crossings without a synchronizer.')).toBeVisible();
        expect(has('fir_ctrl_0/M_AXIS_CONFIG')).toBe(true);
        expect(rowOf('ext_clk')).toBeUndefined();
        expect(rowOf('FCLK_CLK0')).toBeDefined();
        expect(showUnchecked(2)).toBeVisible();

        fireEvent.click(crumbs().getByRole('button', { name: 'zynq_clock_domains' }));
        await screen.findByTestId('node:/axi_dma_0');
        expect(tabCount('Clocks', 3)).toBeVisible();
        expect(bottom().getByText('1 crossing without a synchronizer.')).toBeVisible();
        expect(has('fir_ctrl_0/M_AXIS_CONFIG')).toBe(false);
      });

      it('changes the Resets tab when entering dsp_pipeline and back', async () => {
        await domains();
        openResets();
        expect(tabCount('Resets', 3)).toHaveAttribute('aria-selected', 'true');
        expect(rowOf('processing_system7_0/FCLK_RESET0_N')).toBeDefined();
        expect(bottom().getByText('2 reset crossings without a synchronizer.')).toBeVisible();

        fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
        await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
        expect(tabCount('Resets', 1)).toHaveAttribute('aria-selected', 'true');
        expect(rowOf('processing_system7_0/FCLK_RESET0_N')).toBeUndefined();
        expect(rowOf('rst_ps7_0_100M/peripheral_aresetn')).toBeDefined();
        expect(bottom().getByText('2 reset crossings without a synchronizer.')).toBeVisible();

        fireEvent.click(crumbs().getByRole('button', { name: 'zynq_clock_domains' }));
        await screen.findByTestId('node:/axi_dma_0');
        expect(tabCount('Resets', 3)).toBeVisible();
        expect(rowOf('processing_system7_0/FCLK_RESET0_N')).toBeDefined();
      });

      it('adds the rows of a block expanded in place, and drops them on collapse', async () => {
        await domains();
        expect(has('fir_ctrl_0/M_AXIS_CONFIG')).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Expand dsp_pipeline in place' }));
        await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
        expect(bottom().getByText('2 crossings without a synchronizer.')).toBeVisible();
        expect(has('fir_ctrl_0/M_AXIS_CONFIG')).toBe(true);
        expect(showUnchecked(2)).toBeVisible();
        // The root still shows its own domains, and the block adds none.
        expect(tabCount('Clocks', 3)).toBeVisible();
        expect(rowOf('ext_clk')).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: 'Collapse dsp_pipeline' }));
        await waitFor(() => expect(has('fir_ctrl_0/M_AXIS_CONFIG')).toBe(false));
        expect(bottom().getByText('1 crossing without a synchronizer.')).toBeVisible();
      });

      it('leaves the toolbar count design-wide', async () => {
        await domains();
        expect(toggle()).toHaveTextContent('2 CDC · 2 RDC');
        fireEvent.doubleClick(screen.getByTestId('node:/dsp_pipeline'));
        await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0');
        expect(toggle()).toHaveTextContent('2 CDC · 2 RDC');
      });
    });

    it('selects the net of a clicked data crossing and haloes its sink pin', async () => {
      await domains();
      const row = () => bottom().getByText('fir_compiler_0/M_AXIS_DATA').closest('tr')!;
      fireEvent.click(row());
      await waitFor(() => expect(row()).toHaveClass('sd-row-selected'));
      expect(details().getByRole('heading', { name: 'dsp_pipeline_M_AXIS' })).toBeVisible();
      expect(
        screen.getByTestId('node:/axi_dma_0').parentElement!.querySelectorAll('.sd-pin-halo')
      ).toHaveLength(1);
    });

    it('selects the net of a clicked reset crossing and haloes its sink pin', async () => {
      await domains();
      openResets();
      const halos = (id: string) =>
        screen.getByTestId(`node:${id}`).parentElement!.querySelectorAll('.sd-pin-halo');
      fireEvent.click(bottom().getByText('fir_compiler_0/aresetn').closest('tr')!);
      await screen.findByTestId(`node:${DSP}/fir_compiler_0`);
      expect(details().getByRole('heading', { name: 'aresetn_1' })).toBeVisible();
      expect(halos(`${DSP}/fir_compiler_0`)).toHaveLength(1);
      expect(bottom().getByText('fir_compiler_0/aresetn').closest('tr')).toHaveClass(
        'sd-row-selected'
      );
      const crumbs = within(screen.getByRole('navigation', { name: 'Hierarchy' }));
      expect(crumbs.getByText('dsp_pipeline')).toHaveAttribute('aria-current', 'page');
      fireEvent.click(screen.getByTestId(`node:${DSP}/fir_compiler_0`));
      expect(halos(`${DSP}/fir_compiler_0`)).toHaveLength(0);
    });

    describe('zooms in to the sink block of a clicked crossing at low zoom, but never zooms out', () => {
      const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)));
      // The first click goes to the row's level, whose first visit fits; the second measures.
      async function clickAt(zoom: number, text: string, nodeId: string) {
        const row = () => bottom().getByText(text).closest('tr')!;
        fireEvent.click(row());
        await screen.findByTestId(`node:${nodeId}`);
        await settle();
        mockSetCenter.mockClear();
        mockViewport = { x: 0, y: 0, zoom };
        fireEvent.click(row());
        await waitFor(() => expect(mockSetCenter).toHaveBeenCalledTimes(1));
        return (mockSetCenter.mock.calls[0][2] as { zoom: number }).zoom;
      }

      it('for a crossing, centring its sink block', async () => {
        await domains();
        openResets();
        const zoom = await clickAt(0.3, 'fir_compiler_0/aresetn', `${DSP}/fir_compiler_0`);
        expect(zoom).toBeGreaterThan(0.3);
        expect(zoom).toBeLessThanOrEqual(0.8);
        expect(await clickAt(1.7, 'ovf_monitor_0/rst_n', `${DSP}/ovf_monitor_0`)).toBe(1.7);
      });
    });

    it('draws the frequency next to each clock pin, in its domain color', async () => {
      await domains();
      const labels = nodeBox('/axi_dma_0', '.sd-node').querySelectorAll('.sd-pin-freq');
      expect([...labels].map((label) => label.textContent)).toEqual([
        '100 MHz',
        '100 MHz',
        '100 MHz',
      ]);
      expect((labels[0] as HTMLElement).style.color).toBe('var(--vscode-charts-purple)');
      expect(nodeBox('/::ext_clk', '.sd-port').querySelector('.sd-pin-freq')).toHaveTextContent(
        '125 MHz'
      );
      fireEvent.click(toggle());
      expect(nodeBox('/axi_dma_0', '.sd-node').querySelector('.sd-pin-freq')).toBeNull();
    });

    it('splits the header strip by domain and badges the crossings', async () => {
      await domains();
      const strip = nodeBox(`/dsp_pipeline`, '.sd-node-strip');
      expect(strip.children).toHaveLength(2);
      // A name the badge truncates stays readable in the tooltip.
      expect(nodeBox(DSP, '.sd-node-name')).toHaveAttribute('title', 'dsp_pipeline');
      const label = '2 clock domain crossings and 2 reset domain crossings';
      expect(within(nodeBox(DSP, '.sd-node')).getByRole('img', { name: label })).toHaveTextContent(
        '2 CDC · 2 RDC'
      );
      expect(nodeBox('/axi_dma_0', '.sd-node-strip').children).toHaveLength(1);
      expect(nodeBox('/axi_dma_0', '.sd-node-dom')).toHaveTextContent('1 CDC');
      expect(nodeBox('/ps7_0_axi_periph', '.sd-node-dom')).toBeNull();
      expect(nodeBox('/axi_dma_0', '.sd-node')).toHaveAttribute('data-crossing-end', 'true');
      expect(nodeBox('/ps7_0_axi_periph', '.sd-node')).toHaveAttribute(
        'data-crossing-end',
        'false'
      );
      fireEvent.click(toggle());
      expect(nodeBox('/axi_dma_0', '.sd-node-strip')).toBeNull();
    });

    it('shows the domain dots and the crossings inside a hierarchy in the outline', async () => {
      await renderWithGraph({ design: clockGraph });
      expect(
        outline().queryByTitle('FCLK_CLK0 100 MHz, FCLK_CLK1 200 MHz')
      ).not.toBeInTheDocument();
      fireEvent.click(toggle());
      const hier = outline().getByRole('button', { name: /^dsp_pipeline/ });
      expect(within(hier).getByTitle('FCLK_CLK0 100 MHz, FCLK_CLK1 200 MHz')).toBeInTheDocument();
      expect(within(hier).getByTitle('Clock and reset domain crossings inside')).toHaveTextContent(
        '4'
      );
      const dma = outline().getByRole('button', { name: /^axi_dma_0/ });
      expect(within(dma).getByTitle('FCLK_CLK0 100 MHz')).toBeInTheDocument();
      expect(within(dma).queryByTitle('Clock and reset domain crossings inside')).toBeNull();
    });

    it('selects the whole tree of a clock net: pins, badges, and the blocks it misses', async () => {
      await renderWithGraph({ design: clockGraph });
      const badge = (netName: string) =>
        screen.getAllByTitle(new RegExp(`^Clock net ${netName}\\.`));
      expect(badge('processing_system7_0_FCLK_CLK1')[0]).not.toHaveAttribute(
        'data-selected',
        'true'
      );
      fireEvent.click(badge('processing_system7_0_FCLK_CLK1')[0]);
      for (const element of badge('processing_system7_0_FCLK_CLK1')) {
        expect(element).toHaveAttribute('data-selected', 'true');
      }
      for (const element of badge('processing_system7_0_FCLK_CLK0')) {
        expect(element).not.toHaveAttribute('data-selected', 'true');
      }
      expect(nodeBox('/axi_dma_0', '.sd-node')).toHaveAttribute('data-dimmed', 'true');
      expect(nodeBox(DSP, '.sd-node')).toHaveAttribute('data-dimmed', 'false');
      expect(nodeBox('/processing_system7_0', '.sd-node')).toHaveAttribute('data-dimmed', 'false');
      // The frequency of the selected domain only.
      const frequencies = (id: string) =>
        [...screen.getByTestId(`node:${id}`).parentElement!.querySelectorAll('.sd-pin-freq')].map(
          (label) => label.textContent
        );
      expect(frequencies(DSP)).toEqual(['200 MHz']);
      expect(frequencies('/axi_dma_0')).toEqual([]);
      fireEvent.click(screen.getByTestId('node:/axi_dma_0'));
      expect(nodeBox('/axi_dma_0', '.sd-node')).toHaveAttribute('data-dimmed', 'false');
      expect(frequencies(DSP)).toEqual([]);
    });

    it('does not dim anything for a data net', async () => {
      await renderWithGraph({ design: clockGraph });
      fireEvent.click(outline().getByRole('button', { name: /^axi_dma_0/ }));
      expect(nodeBox('/axi_dma_0', '.sd-node')).toHaveAttribute('data-dimmed', 'false');
      expect(nodeBox(DSP, '.sd-node')).toHaveAttribute('data-dimmed', 'false');
    });

    it('adds the clocks of a block to its details', async () => {
      await renderWithGraph({ design: clockGraph });
      fireEvent.click(outline().getByRole('button', { name: 'Expand dsp_pipeline' }));
      fireEvent.click(outline().getByRole('button', { name: /^fir_compiler_0/ }));
      const clocks = details().getByRole('heading', { name: 'Clocks' }).closest('section')!;
      expect(within(clocks).getByRole('button', { name: 'FCLK_CLK1 · 200 MHz' })).toBeVisible();
      expect(within(clocks).getByText('S_AXIS_DATA').closest('tr')).toHaveTextContent('aclk');
      expect(within(clocks).getByText('S_AXIS_DATA').closest('tr')).toHaveTextContent(
        'single clock'
      );
      const resets = within(clocks).getByRole('heading', { name: 'Resets' });
      expect(resets).toBeVisible();
      expect(within(clocks).getByText('✗ clocked by FCLK_CLK1 · 200 MHz')).toBeVisible();
      fireEvent.click(within(clocks).getByRole('button', { name: 'FCLK_CLK1 · 200 MHz' }));
      expect(details().getByText(/^Clock net · domain/)).toBeVisible();
    });

    it('says how many clock domains a leaf block uses, not a block on one domain or a hierarchy', async () => {
      await renderWithGraph({ design: clockGraph });
      fireEvent.click(outline().getByRole('button', { name: 'Expand dsp_pipeline' }));
      fireEvent.click(outline().getByRole('button', { name: /^axis_data_fifo_0/ }));
      const clocks = details().getByRole('heading', { name: 'Clocks' }).closest('section')!;
      expect(
        within(clocks).getByText('This block uses 2 clock domains: FCLK_CLK0, FCLK_CLK1.')
      ).toBeVisible();
      fireEvent.click(outline().getByRole('button', { name: /^fir_compiler_0/ }));
      expect(details().queryByText(/This block uses/)).not.toBeInTheDocument();
      fireEvent.click(outline().getByRole('button', { name: /^dsp_pipeline/ }));
      expect(details().queryByText(/This block uses/)).not.toBeInTheDocument();
    });

    it('says when the clocks of a block are not known, and why', async () => {
      await renderWithGraph({ design: clockGraph });
      fireEvent.click(outline().getByRole('button', { name: 'Expand dsp_pipeline' }));
      fireEvent.click(outline().getByRole('button', { name: /^axis_data_fifo_0/ }));
      expect(details().getAllByText('not checked')).toHaveLength(2);
      expect(details().getByText(/Set the Vivado install directory/)).toBeVisible();
      fireEvent.click(outline().getByRole('button', { name: /^axi_dma_0/ }));
      expect(details().queryByText(/Set the Vivado install directory/)).not.toBeInTheDocument();
    });

    it('shows the domain of an external clock port and the release of a reset port', async () => {
      await renderWithGraph({ design: clockGraph });
      fireEvent.click(outline().getByRole('button', { name: /^ext_clk/ }));
      expect(details().getByText('Clock domain', { exact: false })).toHaveTextContent(
        'ext_clk · 125 MHz'
      );
      fireEvent.click(outline().getByRole('button', { name: /^ext_resetn/ }));
      expect(details().getByText(/^Reset\s+released on/)).toHaveTextContent('ext_clk · 125 MHz');
      // The link opens the clock net of the releasing domain, not the reset's own net.
      fireEvent.click(details().getByRole('button', { name: 'ext_clk · 125 MHz' }));
      expect(details().getByRole('heading', { name: 'ext_clk_1' })).toBeVisible();
      expect(details().getByText(/^Clock net · domain/)).toBeVisible();
    });

    it('notes a crossing in the details of a data net, and a net not checked', async () => {
      await renderWithGraph({ design: clockGraph });
      fireEvent.click(bottom().getByRole('tab', { name: /^Clocks/ }));
      fireEvent.click(outline().getByRole('button', { name: /^axi_dma_0/ }));
      fireEvent.click(details().getByRole('button', { name: 'dsp_pipeline_M_AXIS' }));
      expect(details().getByText('Clock domain crossing.')).toBeVisible();
      expect(
        details().getByText(/is on FCLK_CLK1 and axi_dma_0\/S_AXIS_S2MM on FCLK_CLK0/)
      ).toBeVisible();
      fireEvent.click(outline().getByRole('button', { name: /^axi_dma_0/ }));
      fireEvent.click(details().getByRole('button', { name: 'axi_dma_0_M_AXIS_MM2S' }));
      expect(details().getByText(/Clock domains not checked:/)).toBeVisible();
    });
  });

  describe('clock domains of a design that sets no frequency (Versal platform)', () => {
    const versal = loadVersalClockGraph();
    const bottom = () => within(screen.getByRole('region', { name: 'Bottom panel' }));
    const toggle = () => screen.getByRole('button', { name: /^Clock domains/ });
    const nodeBox = (id: string, selector: string) =>
      screen.getByTestId(`node:${id}`).parentElement!.querySelector(selector) as HTMLElement;
    const rowOf = (text: string) =>
      bottom()
        .getAllByRole('row')
        .find((row) => within(row).queryAllByRole('cell')[0]?.textContent?.trim() === text)!;
    const openResets = () => fireEvent.click(screen.getByRole('tab', { name: /^Resets/ }));
    async function domains(design: typeof versal = versal) {
      await renderWithGraph({ design, ready: '/stream_src' });
      fireEvent.click(toggle());
    }

    it('counts the domains in the toolbar: related clocks are no crossing', async () => {
      await renderWithGraph({ design: versal, ready: '/stream_src' });
      expect(toggle()).toHaveTextContent(/Clock domains\s*3$/);
    });

    it('shows no word "unknown" and no frequency anywhere in the domain mode', async () => {
      await domains();
      expect(screen.getByRole('region', { name: 'Bottom panel' }).textContent).not.toMatch(
        /unknown/i
      );
      expect(document.body.textContent).not.toMatch(/unknown|\bMHz\b|\bGHz\b|\bkHz\b/i);
      expect(document.querySelectorAll('.sd-pin-freq')).toHaveLength(0);
    });

    it('leaves the Frequency cell of a domain empty, and shows where it comes from only when known', async () => {
      await domains();
      const cells = within(rowOf('clk_out1')).getAllByRole('cell');
      expect(cells[1]).toBeEmptyDOMElement();
      expect(cells[2]).toHaveTextContent('clk_wizard_0/clk_out1');
      expect(cells[3]).toBeEmptyDOMElement();
      expect(cells[4]).toHaveTextContent('5');
    });

    it('lists no row for related clocks, and says no crossing was found', async () => {
      await domains();
      expect(bottom().getByText('No clock domain crossings on this level.')).toBeVisible();
      expect(bottom().queryByRole('columnheader', { name: 'Problem' })).not.toBeInTheDocument();
      expect(bottom().queryByText('stream_src/M_AXIS')).not.toBeInTheDocument();
      expect(bottom().queryByText(/Both clocks come from/)).not.toBeInTheDocument();
      expect(bottom().queryByRole('checkbox')).not.toBeInTheDocument();
      openResets();
      expect(bottom().getByText('No reset domain crossings on this level.')).toBeVisible();
      expect(bottom().queryByText('stream_src/aresetn')).not.toBeInTheDocument();
      expect(bottom().queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('marks no block as a crossing and badges no node', async () => {
      await domains();
      expect(nodeBox('/stream_src', '.sd-node')).toHaveAttribute('data-crossing-end', 'false');
      expect(nodeBox('/stream_sink', '.sd-node')).toHaveAttribute('data-crossing-end', 'false');
      expect(document.querySelectorAll('.sd-node-dom')).toHaveLength(0);
    });

    it('opens a clock tree without a frequency line: the source and a muted note', async () => {
      await domains();
      fireEvent.click(rowOf('clk_out1'));
      expect(details().getByText(/^Clock net · domain/)).toHaveTextContent('clk_out1');
      expect(document.querySelector('.sd-freq-big')).toBeNull();
      expect(details().getByText('Frequency not set in the script.')).toBeVisible();
      expect(details().getByRole('button', { name: 'clk_wizard_0/clk_out1' })).toBeVisible();
      expect(details().queryByText(/Source not known/)).not.toBeInTheDocument();
      expect(details().queryByText('None found.')).not.toBeInTheDocument();
      expect(details().getByText(/Both clocks come from clk_wizard_0/)).toBeVisible();
      expect(details().getByText('Related clocks.')).toBeVisible();
    });

    it('checks a reset sink on a related clock as related, not as a crossing', async () => {
      await domains();
      openResets();
      fireEvent.click(rowOf('rst_clk_out2/peripheral_aresetn'));
      expect(details().getByText(/^Reset net · released on/)).toHaveTextContent('clk_out2');
      expect(details().getByText('≈ related clocks')).toBeVisible();
      expect(details().getByText('✓ clk_out2')).toBeVisible();
      expect(details().queryByText('Reset domain crossing.')).not.toBeInTheDocument();
    });

    it('says the source is not known when no rule or direction names it', async () => {
      const unknown = loadVersalClockGraph();
      unknown.instances['/clk_wizard_0'].vlnv = 'acme.com:ip:other_wizard:1.0';
      await domains(unknown);
      const first = rowOf('clk_wizard_0_clk_out1');
      expect(within(first).getAllByRole('cell')[2]).toHaveTextContent('not known');
      fireEvent.click(first);
      expect(
        details().getByText(
          'Source not known: no rule or declared direction names one pin as the driver.'
        )
      ).toBeVisible();
      expect(details().getByText('Frequency not set in the script.')).toBeVisible();
      expect(details().queryByText('source')).not.toBeInTheDocument();
      expect(document.querySelector('.sd-freq-big')).toBeNull();
    });

    it('lists a reset whose source is not known, and checks none of its non-asynchronous sinks', async () => {
      const unknown = loadVersalClockGraph();
      unknown.instances['/ps_cips'].vlnv = 'acme.com:ip:other_ps:1.0';
      await domains(unknown);
      openResets();
      const row = rowOf('ps_cips_pl0_resetn');
      expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('unknown');
      expect(within(row).getAllByRole('cell')[2]).toHaveTextContent('source not known');
      expect(within(row).getAllByRole('cell')[3]).toHaveTextContent('4');
      fireEvent.click(row);
      expect(details().getByText(/^Reset net · release clock unknown/)).toBeVisible();
      expect(
        details().getByText(
          'Source not known: no rule or declared direction names one pin as the driver.'
        )
      ).toBeVisible();
      expect(details().queryByText('source')).not.toBeInTheDocument();
      expect(details().getByText('Reset tree · 4 sinks')).toBeVisible();
      expect(details().getByText('? source not known')).toBeVisible();
      expect(details().getAllByText('✓ asynchronous input')).toHaveLength(3);
      const reason =
        'The source of ps_cips_pl0_resetn is not known, so the clock that releases it is not known';
      expect(bottom().queryByText(reason)).not.toBeInTheDocument();
      fireEvent.click(bottom().getByRole('checkbox', { name: 'Show 1 that could not be checked' }));
      expect(bottom().getByText(reason)).toBeVisible();
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
      expect(screen.queryByRole('region', { name: 'Bottom panel' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^\d+ problems?$/ }));
      expect(screen.getByRole('tab', { name: /Problems/ })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });
  });

  it('shows an empty state for scripts that are not block designs', () => {
    render(<SystemDiagramApp />);
    send({ type: 'notRecognized', fileName: 'build.tcl' });
    expect(
      screen.getByText('This file is not a Vivado block design script or Platform Designer system.')
    ).toBeVisible();
  });

  it('shows read errors', () => {
    render(<SystemDiagramApp />);
    send({ type: 'error', message: 'boom' });
    expect(screen.getByText(/boom/)).toBeVisible();
  });
});
