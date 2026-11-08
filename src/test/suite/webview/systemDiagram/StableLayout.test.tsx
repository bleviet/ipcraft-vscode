import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SystemDiagramApp } from '../../../../webview/systemDiagram/SystemDiagramApp';
import { isolationSubset } from '../../../../webview/systemDiagram/isolation';
import { levelEdges } from '../../../../webview/systemDiagram/layout/levelEdges';
import { isClockOrReset } from '../../../../webview/systemDiagram/model';
import type { SystemDiagramToWebviewMessage } from '../../../../shared/messages/systemDiagram';
import { loadFixtureGraph } from './fixtureGraph';

// Issues #255 and #258: the Clocks and resets and Unconnected pins toggles change
// what is drawn, never where the blocks sit. React Flow is mocked to hand the test the
// `nodes` and `edges` the canvas passes it; ELK runs for real.
const mockFitBounds = jest.fn<void, unknown[]>();
const mockSetCenter = jest.fn<void, unknown[]>();
const mockSetViewport = jest.fn<void, unknown[]>();
let mockLayoutRuns: Promise<unknown>[] = [];

jest.mock('../../../../webview/vscode', () => ({ vscode: { postMessage: jest.fn() } }));

jest.mock('../../../../webview/systemDiagram/layout/runElkLayout', () => {
  const actual = jest.requireActual<
    typeof import('../../../../webview/systemDiagram/layout/runElkLayout')
  >('../../../../webview/systemDiagram/layout/runElkLayout');
  return {
    runElkLayout: (input: Parameters<typeof actual.runElkLayout>[0]) => {
      const run = actual.runElkLayout(input);
      mockLayoutRuns.push(run);
      return run;
    },
  };
});

interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  data: unknown;
}
interface FlowEdge {
  id: string;
  data: { category: string; dimmed?: true };
}
interface FlowProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  nodeTypes: Record<string, React.ComponentType<{ data: unknown }>>;
  children?: React.ReactNode;
  onNodeContextMenu: (event: unknown, node: FlowNode) => void;
}
let mockFlow: FlowProps | null = null;

jest.mock('@xyflow/react', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const actualFlow = jest.requireActual<typeof import('@xyflow/react')>('@xyflow/react');
  const api = {
    fitBounds: (...args: unknown[]) => mockFitBounds(...args),
    setCenter: (...args: unknown[]) => mockSetCenter(...args),
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: (...args: unknown[]) => mockSetViewport(...args),
  };
  return {
    Background: () => null,
    BackgroundVariant: { Dots: 'dots' },
    BaseEdge: () => null,
    Handle: () => null,
    Panel: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    MiniMap: () => React.createElement('div', { 'aria-label': 'Minimap' }),
    useStore: (selector: (state: unknown) => unknown) => selector({ transform: [0, 0, 1] }),
    Position: { Left: 'left', Right: 'right' },
    ReactFlow: (props: FlowProps) => {
      mockFlow = props;
      return React.createElement(
        'div',
        null,
        props.nodes.map((node) =>
          React.createElement(
            'div',
            { key: node.id },
            React.createElement('button', {
              'data-testid': `node:${node.id}`,
              onContextMenu: (event: { stopPropagation: () => void }) => {
                event.stopPropagation();
                props.onNodeContextMenu(event, node);
              },
            }),
            React.createElement(props.nodeTypes[node.type], { data: node.data })
          )
        ),
        props.children
      );
    },
    getViewportForBounds: actualFlow.getViewportForBounds,
    useStoreApi: () => ({
      getState: () => ({
        width: 1000,
        height: 800,
        minZoom: 0.05,
        maxZoom: 2,
        transform: [0, 0, 1],
      }),
      subscribe: () => () => undefined,
    }),
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
    useReactFlow: () => api,
  };
});

const graph = loadFixtureGraph();
const clocksAndResets = () => screen.getByRole('button', { name: 'Clocks and resets' });
const clocksChip = () => screen.getByRole('button', { name: /^Open the Clocks tab: / });
const unconnectedPins = () => screen.getByRole('button', { name: /^Unconnected pins/ });

function clearViewportCalls(): void {
  mockFitBounds.mockClear();
  mockSetCenter.mockClear();
  mockSetViewport.mockClear();
}

/** Waits for every ELK run started so far and for the render that follows. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.allSettled(mockLayoutRuns);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

// Every test waits for ELK, the first one for its cold start too: they get 20 s, Jest's default is 5 s.
async function renderApp(): Promise<void> {
  render(<SystemDiagramApp />);
  const message: SystemDiagramToWebviewMessage = { type: 'graph', graph };
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
  await screen.findByTestId('node:/axi_dma_0', {}, { timeout: 10000 });
  await settle();
  clearViewportCalls();
}

const flow = (): FlowProps => mockFlow!;
const placement = () =>
  flow()
    .nodes.map(({ id, position, width, height }) => ({ id, position, width, height }))
    .sort((a, b) => a.id.localeCompare(b.id));
const wireCategories = () => new Set(flow().edges.map((edge) => edge.data.category));
const dimmedWires = () => flow().edges.filter((edge) => edge.data.dimmed);
/** Pins colored by their clock domain, as `node/pin`. */
const domainPins = () =>
  flow().nodes.flatMap((node) =>
    Object.entries((node.data as { pinMarks?: Record<string, { color?: string }> }).pinMarks ?? {})
      .filter(([, mark]) => mark.color !== undefined)
      .map(([pin]) => `${node.id}/${pin}`)
  );
const badges = () => [...document.querySelectorAll('.sd-badge')];

beforeEach(() => {
  mockLayoutRuns = [];
  mockFlow = null;
});

describe('the placement of the blocks across the view toggles', () => {
  it('stays when Clocks and resets is toggled', async () => {
    await renderApp();
    const before = placement();
    const runs = mockLayoutRuns.length;
    const wires = flow().edges.length;

    fireEvent.click(clocksAndResets());
    await settle();
    expect(flow().edges).toHaveLength(wires);
    expect(placement()).toEqual(before);

    fireEvent.click(clocksAndResets());
    await settle();
    expect(flow().edges).toHaveLength(wires);
    expect(placement()).toEqual(before);
    expect(mockLayoutRuns).toHaveLength(runs);
  }, 20000);

  it('stays when Unconnected pins is toggled', async () => {
    await renderApp();
    const before = placement();
    const runs = mockLayoutRuns.length;

    fireEvent.click(unconnectedPins());
    await settle();
    expect(placement()).toEqual(before);

    fireEvent.click(unconnectedPins());
    await settle();
    expect(placement()).toEqual(before);
    expect(mockLayoutRuns).toHaveLength(runs);
  }, 20000);

  it('stays when Unconnected pins pauses the decorations of Clocks and resets, and restores them', async () => {
    await renderApp();
    const before = placement();
    const runs = mockLayoutRuns.length;

    fireEvent.click(clocksAndResets());
    await settle();
    expect(placement()).toEqual(before);

    fireEvent.click(unconnectedPins());
    await settle();
    expect(clocksAndResets()).toHaveAttribute('aria-pressed', 'true');
    expect(unconnectedPins()).toHaveAttribute('aria-pressed', 'true');
    expect(placement()).toEqual(before);

    fireEvent.click(unconnectedPins());
    await settle();
    expect(clocksAndResets()).toHaveAttribute('aria-pressed', 'true');
    expect(unconnectedPins()).toHaveAttribute('aria-pressed', 'false');
    expect(placement()).toEqual(before);

    fireEvent.click(clocksAndResets());
    await settle();
    expect(placement()).toEqual(before);
    expect(mockLayoutRuns).toHaveLength(runs);
  }, 20000);

  it('lays out once per view and leaves the viewport alone', async () => {
    await renderApp();
    // Showing the bottom panel refits the view; the Unconnected pins toggle and the count
    // chip open it, so open it first to see what the toggles themselves do.
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Bottom Panel' }));
    await settle();
    clearViewportCalls();
    const runs = mockLayoutRuns.length;

    fireEvent.click(clocksAndResets());
    fireEvent.click(unconnectedPins());
    fireEvent.click(clocksChip());
    fireEvent.click(clocksAndResets());
    fireEvent.click(unconnectedPins());
    fireEvent.click(clocksAndResets());
    await settle();

    expect(mockLayoutRuns).toHaveLength(runs);
    expect(mockFitBounds).not.toHaveBeenCalled();
    expect(mockSetCenter).not.toHaveBeenCalled();
    expect(mockSetViewport).not.toHaveBeenCalled();
  }, 20000);

  it('stays when Auto detail is toggled', async () => {
    await renderApp();
    const before = placement();
    const runs = mockLayoutRuns.length;
    const auto = screen.getByRole('button', { name: 'Auto' });
    expect(auto).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(auto);
    await settle();
    expect(auto).toHaveAttribute('aria-pressed', 'false');
    expect(placement()).toEqual(before);

    fireEvent.click(auto);
    await settle();
    expect(placement()).toEqual(before);
    expect(mockLayoutRuns).toHaveLength(runs);
  }, 20000);

  it('stays when a legend filter is clicked, Alt+Clicked and cleared', async () => {
    await renderApp();
    const before = placement();
    const runs = mockLayoutRuns.length;
    const wires = flow().edges.length;
    const chip = () => screen.getByRole('button', { name: 'AXI memory-mapped' });

    fireEvent.click(chip());
    await settle();
    expect(chip()).toHaveAttribute('aria-pressed', 'false');
    expect(wireCategories()).not.toContain('aximm');
    expect(placement()).toEqual(before);

    fireEvent.click(chip());
    fireEvent.click(chip(), { altKey: true });
    await settle();
    expect([...wireCategories()]).toEqual(['aximm']);
    expect(placement()).toEqual(before);

    fireEvent.click(chip(), { altKey: true });
    await settle();
    expect(flow().edges).toHaveLength(wires);
    expect(placement()).toEqual(before);
    expect(mockLayoutRuns).toHaveLength(runs);
  }, 20000);

  it('stays when the minimap is shown and hidden', async () => {
    await renderApp();
    const before = placement();
    const runs = mockLayoutRuns.length;
    const shown = () => screen.queryByLabelText('Minimap') !== null;
    const initial = shown();

    fireEvent.click(
      screen.getByRole('button', { name: initial ? 'Hide minimap' : 'Show minimap' })
    );
    await settle();
    expect(shown()).toBe(!initial);
    expect(placement()).toEqual(before);

    fireEvent.click(
      screen.getByRole('button', { name: initial ? 'Show minimap' : 'Hide minimap' })
    );
    await settle();
    expect(shown()).toBe(initial);
    expect(placement()).toEqual(before);
    expect(mockLayoutRuns).toHaveLength(runs);
  }, 20000);

  it('stays in an isolated view, which keeps the same blocks either way', async () => {
    // The periph block is clocked by the PS, which a data wire keeps in the isolated view.
    const isolated = '/ps7_0_axi_periph';
    const kept = isolationSubset(graph, '/', [isolated]).edgeIds;
    const clockEdgeIds = levelEdges(graph, '/')
      .filter((edge) => isClockOrReset(edge) && kept.has(edge.id))
      .map((edge) => edge.id);
    expect(clockEdgeIds.length).toBeGreaterThan(0);

    await renderApp();
    fireEvent.contextMenu(screen.getByTestId(`node:${isolated}`));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Isolate Selection' }));
    await settle();
    const ids = flow().nodes.map((node) => node.id);
    const before = placement();
    const runs = mockLayoutRuns.length;
    const drawnClockEdgeIds = () =>
      flow()
        .edges.map((edge) => edge.id)
        .filter((id) => clockEdgeIds.includes(id))
        .sort();
    expect(drawnClockEdgeIds()).toEqual([]);

    fireEvent.click(clocksAndResets());
    await settle();
    expect(flow().nodes.map((node) => node.id)).toEqual(ids);
    expect(placement()).toEqual(before);
    expect(drawnClockEdgeIds()).toEqual([]);

    fireEvent.click(unconnectedPins());
    await settle();
    expect(placement()).toEqual(before);
    expect(drawnClockEdgeIds()).toEqual([]);
    expect(mockLayoutRuns).toHaveLength(runs);
  }, 20000);

  it('stays in a two-hop isolation and in a traced path', async () => {
    await renderApp();
    fireEvent.contextMenu(screen.getByTestId('node:/axi_gpio_0'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Isolate Selection' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '2-Hop' }));
    await settle();
    expect(flow().nodes.length).toBe(5);

    const toggles = async () => {
      const before = placement();
      const runs = mockLayoutRuns.length;
      fireEvent.click(clocksAndResets());
      await settle();
      expect(placement()).toEqual(before);
      fireEvent.click(unconnectedPins());
      await settle();
      expect(placement()).toEqual(before);
      fireEvent.click(unconnectedPins());
      fireEvent.click(clocksAndResets());
      await settle();
      expect(placement()).toEqual(before);
      expect(mockLayoutRuns).toHaveLength(runs);
    };
    await toggles();

    fireEvent.click(screen.getByRole('button', { name: 'Trace path' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'From' }), {
      target: { value: '/processing_system7_0' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'To' }), {
      target: { value: '/axi_gpio_0' },
    });
    await settle();
    expect(flow().nodes).toHaveLength(3);
    await toggles();
  }, 20000);

  it('stays with a hierarchy block expanded in place', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Expand dsp_pipeline in place' }));
    await screen.findByTestId('node:/dsp_pipeline/fir_compiler_0', {}, { timeout: 10000 });
    await settle();
    const before = placement();
    const runs = mockLayoutRuns.length;

    fireEvent.click(clocksAndResets());
    await settle();
    expect(placement()).toEqual(before);

    fireEvent.click(unconnectedPins());
    await settle();
    expect(placement()).toEqual(before);

    fireEvent.click(unconnectedPins());
    fireEvent.click(clocksAndResets());
    await settle();
    expect(placement()).toEqual(before);
    expect(mockLayoutRuns).toHaveLength(runs);
  }, 20000);
});

describe('what the toggles draw', () => {
  it('draws the clock and reset badges, not their wires, while Clocks and resets is off', async () => {
    await renderApp();
    expect(wireCategories()).not.toContain('clock');
    expect(wireCategories()).not.toContain('reset');
    expect(badges().length).toBeGreaterThan(0);
  }, 20000);

  it('keeps the badges and draws no clock or reset wire while Clocks and resets is on', async () => {
    await renderApp();
    const shown = badges().length;
    fireEvent.click(clocksAndResets());
    await settle();
    expect(wireCategories()).not.toContain('clock');
    expect(wireCategories()).not.toContain('reset');
    expect(badges()).toHaveLength(shown);
  }, 20000);

  it('colors the clock and reset pins by domain and dims the data wires while Clocks and resets is on', async () => {
    await renderApp();
    expect(domainPins()).toHaveLength(0);
    expect(dimmedWires()).toHaveLength(0);
    fireEvent.click(clocksAndResets());
    await settle();
    expect(domainPins()).toContain('/axi_dma_0/s_axi_lite_aclk');
    expect(dimmedWires().length).toBeGreaterThan(0);
  }, 20000);

  it('pauses the domain colors while the Unconnected pins review is on, and restores them', async () => {
    await renderApp();
    fireEvent.click(clocksAndResets());
    fireEvent.click(unconnectedPins());
    await settle();
    expect(wireCategories()).not.toContain('clock');
    expect(badges().length).toBeGreaterThan(0);
    expect(domainPins()).toHaveLength(0);
    expect(dimmedWires()).toHaveLength(0);

    fireEvent.click(unconnectedPins());
    await settle();
    expect(domainPins().length).toBeGreaterThan(0);
    expect(dimmedWires().length).toBeGreaterThan(0);
  }, 20000);

  it('draws the badges of the clock and reset nets again when only the review is on', async () => {
    await renderApp();
    fireEvent.click(unconnectedPins());
    await settle();
    expect(wireCategories()).not.toContain('clock');
    expect(badges().length).toBeGreaterThan(0);
  }, 20000);
});
