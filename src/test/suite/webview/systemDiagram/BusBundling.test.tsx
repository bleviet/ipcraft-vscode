import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SystemDiagramApp } from '../../../../webview/systemDiagram/SystemDiagramApp';
import type { SystemDiagramToWebviewMessage } from '../../../../shared/messages/systemDiagram';
import { bundlingGraph, designOf, instance, net } from './bundlingGraph';
import { pin } from './foldingGraph';

// Bundle buses is a layout input: toggling it, or unbundling a pair, re-runs ELK without a
// refit. ELK runs for real; React Flow is mocked, but its edges are clickable.
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

interface FlowEdge {
  id: string;
  selected?: boolean;
}
interface FlowProps {
  nodes: { id: string; type: string; position: { x: number; y: number }; data: unknown }[];
  edges: FlowEdge[];
  nodeTypes: Record<string, React.ComponentType<{ data: unknown }>>;
  onEdgeClick: (event: unknown, edge: FlowEdge) => void;
  onEdgeContextMenu: (event: unknown, edge: FlowEdge) => void;
  onPaneClick: () => void;
}
let mockFlow: FlowProps | null = null;
const mockFitBounds = jest.fn<void, unknown[]>();

jest.mock('@xyflow/react', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const actualFlow = jest.requireActual<typeof import('@xyflow/react')>('@xyflow/react');
  const api = {
    fitBounds: (...args: unknown[]) => mockFitBounds(...args),
    setCenter: jest.fn(),
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: jest.fn(),
  };
  return {
    Background: () => null,
    BackgroundVariant: { Dots: 'dots' },
    BaseEdge: () => null,
    Handle: () => null,
    Panel: () => null,
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
            React.createElement(props.nodeTypes[node.type], { data: node.data })
          )
        ),
        React.createElement('div', { 'data-testid': 'pane', onClick: props.onPaneClick }),
        props.edges.map((edge) =>
          React.createElement('div', {
            key: edge.id,
            'data-testid': `edge:${edge.id}`,
            'data-selected': edge.selected ? 'true' : undefined,
            onClick: (event: unknown) => props.onEdgeClick(event, edge),
            onContextMenu: (event: { stopPropagation: () => void }) => {
              event.stopPropagation();
              props.onEdgeContextMenu(event, edge);
            },
          })
        )
      );
    },
    getViewportForBounds: actualFlow.getViewportForBounds,
    useStoreApi: () => ({
      getState: () => ({ width: 1000, height: 800, minZoom: 0.05, maxZoom: 2 }),
    }),
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
    useReactFlow: () => api,
  };
});

const BUNDLE = 'bundle:/src->/dst|axis|i';
const bundleEdge = () => screen.queryByTestId(`edge:${BUNDLE}`);
const edgeIds = () => (mockFlow?.edges ?? []).map((edge) => edge.id).sort();
const toggle = () => screen.getByRole('button', { name: 'Bundle buses' });
const details = () => within(screen.getByRole('complementary', { name: 'Details' }));
const positions = () => JSON.stringify(mockFlow!.nodes.map(({ id, position }) => [id, position]));

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.allSettled(mockLayoutRuns);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

async function openApp(design: ReturnType<typeof bundlingGraph>, ready: string) {
  mockLayoutRuns = [];
  mockFlow = null;
  mockFitBounds.mockClear();
  render(<SystemDiagramApp />);
  const message: SystemDiagramToWebviewMessage = { type: 'graph', graph: design };
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
  await screen.findByTestId(`edge:${ready}`, undefined, { timeout: 10000 });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle Details' }));
  await settle();
  mockFitBounds.mockClear();
}

describe('the Bundle buses toggle', () => {
  beforeEach(() => openApp(bundlingGraph(), BUNDLE));

  it('is on by default and draws the parallel streams as one wire', () => {
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(edgeIds()).toEqual([BUNDLE]);
  }, 20000);

  it('lays out again with a wire per stream when switched off, and bundles back on, without a refit', async () => {
    const runs = mockLayoutRuns.length;
    fireEvent.click(toggle());
    await settle();
    expect(mockLayoutRuns.length).toBeGreaterThan(runs);
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(edgeIds()).toEqual(['/::n_a#1', '/::n_b#1', '/::n_c#1']);
    fireEvent.click(toggle());
    await settle();
    expect(edgeIds()).toEqual([BUNDLE]);
    expect(mockFitBounds).not.toHaveBeenCalled();
  }, 20000);

  it('is not moved by the Clocks and resets or Unconnected pins toggles', async () => {
    const before = positions();
    const runs = mockLayoutRuns.length;
    fireEvent.click(screen.getByRole('button', { name: 'Clocks and resets' }));
    fireEvent.click(screen.getByRole('button', { name: /^Unconnected pins/ }));
    await settle();
    expect(mockLayoutRuns).toHaveLength(runs);
    expect(positions()).toBe(before);
    expect(edgeIds()).toContain(BUNDLE);
  }, 20000);
});

describe('clicking a bundle', () => {
  beforeEach(() => openApp(bundlingGraph(), BUNDLE));

  it('selects all its nets and shows the bundle in Details', async () => {
    fireEvent.click(bundleEdge()!);
    expect(bundleEdge()).toHaveAttribute('data-selected', 'true');
    expect(details().getByText('Bus bundle')).toBeInTheDocument();
    expect(details().getByRole('heading', { name: '×3 AXI4-Stream' })).toBeInTheDocument();
    expect(details().getByText('from src to dst')).toBeInTheDocument();
    expect(
      details()
        .getAllByRole('button', { name: /→/ })
        .map((button) => button.textContent)
    ).toEqual(['m_a → s_a', 'm_b → s_b', 'm_c → s_c']);
  }, 20000);

  it('selects one net from a connection link', async () => {
    fireEvent.click(bundleEdge()!);
    fireEvent.click(details().getByRole('button', { name: 'm_b → s_b' }));
    expect(details().getByRole('heading', { name: 'n_b' })).toBeInTheDocument();
    expect(details().queryByText('Bus bundle')).toBeNull();
  }, 20000);

  it('removes all its nets on Cmd+Click when all are selected, and adds them back', async () => {
    fireEvent.click(bundleEdge()!);
    fireEvent.click(bundleEdge()!, { metaKey: true });
    expect(bundleEdge()).not.toHaveAttribute('data-selected');
    expect(details().queryByText('Bus bundle')).toBeNull();
    fireEvent.click(bundleEdge()!, { ctrlKey: true });
    expect(bundleEdge()).toHaveAttribute('data-selected', 'true');
    expect(details().getByText('Bus bundle')).toBeInTheDocument();
  }, 20000);

  it('draws the pair as separate wires on Unbundle in Details, without a refit', async () => {
    fireEvent.click(bundleEdge()!);
    fireEvent.click(details().getByRole('button', { name: 'Unbundle' }));
    await settle();
    expect(edgeIds()).toEqual(['/::n_a#1', '/::n_b#1', '/::n_c#1']);
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(mockFitBounds).not.toHaveBeenCalled();
  }, 20000);

  it('isolates the pair on Isolate pair in Details', async () => {
    fireEvent.click(bundleEdge()!);
    fireEvent.click(details().getByRole('button', { name: 'Isolate pair' }));
    await settle();
    expect(screen.getByText(/Isolated · 2 selected/)).toBeInTheDocument();
  }, 20000);
});

describe('the context menu of a bundle', () => {
  beforeEach(() => openApp(bundlingGraph(), BUNDLE));

  it('offers Unbundle, Isolate Pair and the highlight items, and unbundles', async () => {
    fireEvent.contextMenu(bundleEdge()!);
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Isolate Pair' })).toBeEnabled();
    expect(within(menu).getByRole('menuitem', { name: 'Highlight' })).toBeInTheDocument();
    expect(details().getByText('Bus bundle')).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Unbundle' }));
    await settle();
    expect(edgeIds()).toEqual(['/::n_a#1', '/::n_b#1', '/::n_c#1']);
  }, 20000);

  it('isolates the two blocks on Isolate Pair', async () => {
    fireEvent.contextMenu(bundleEdge()!);
    fireEvent.click(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Isolate Pair' })
    );
    await settle();
    expect(screen.getByText(/Isolated · 2 selected/)).toBeInTheDocument();
  }, 20000);
});

describe('bundles that share nets', () => {
  const TO_B = 'bundle:/src->/b|signal|s';
  const TO_C = 'bundle:/src->/c|signal|s';
  // n_a and n_b each reach both b and c: two bundles over the same two nets.
  const twins = designOf(
    [
      instance('src', [pin('o_a', 'out'), pin('o_b', 'out')]),
      instance('b', [pin('i_a', 'in'), pin('i_b', 'in')]),
      instance('c', [pin('j_a', 'in'), pin('j_b', 'in')]),
    ],
    [
      net('n_a', 'signal', [
        ['/src', 'o_a'],
        ['/b', 'i_a'],
        ['/c', 'j_a'],
      ]),
      net('n_b', 'signal', [
        ['/src', 'o_b'],
        ['/b', 'i_b'],
        ['/c', 'j_b'],
      ]),
    ]
  );

  it('shows the bundle that was clicked, and Unbundle acts on that one', async () => {
    await openApp(twins, TO_B);
    expect(edgeIds()).toEqual([TO_B, TO_C].sort());
    fireEvent.click(screen.getByTestId(`edge:${TO_C}`));
    expect(details().getByText('from src to c')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`edge:${TO_B}`));
    expect(details().getByText('from src to b')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`edge:${TO_C}`));
    fireEvent.click(details().getByRole('button', { name: 'Unbundle' }));
    await settle();
    expect(edgeIds()).toContain(TO_B);
    expect(edgeIds()).not.toContain(TO_C);
  }, 20000);

  it('shows the bundle of a context menu on a bundle whose nets are already selected', async () => {
    await openApp(twins, TO_B);
    fireEvent.click(screen.getByTestId(`edge:${TO_B}`));
    fireEvent.contextMenu(screen.getByTestId(`edge:${TO_C}`));
    expect(details().getByText('from src to c')).toBeInTheDocument();
  }, 20000);

  it('selects the single net of a fan-out bundle and shows the bundle', async () => {
    const fanOut = designOf(
      [instance('src', [pin('o', 'out')]), instance('b', [pin('i0', 'in'), pin('i1', 'in')])],
      [
        net('n', 'signal', [
          ['/src', 'o'],
          ['/b', 'i0'],
          ['/b', 'i1'],
        ]),
      ]
    );
    await openApp(fanOut, TO_B);
    fireEvent.click(screen.getByTestId(`edge:${TO_B}`));
    expect(screen.getByTestId(`edge:${TO_B}`)).toHaveAttribute('data-selected', 'true');
    expect(details().getByText('Bus bundle')).toBeInTheDocument();
    expect(details().getByRole('heading', { name: '×2 Signal' })).toBeInTheDocument();
  }, 20000);

  describe('with a fan-out net', () => {
    // n drives b.i0, b.i1 (one bundle) and c.x (a plain wire).
    const fan = designOf(
      [
        instance('src', [pin('o', 'out')]),
        instance('b', [pin('i0', 'in'), pin('i1', 'in')]),
        instance('c', [pin('x', 'in')]),
      ],
      [
        net('n', 'signal', [
          ['/src', 'o'],
          ['/b', 'i0'],
          ['/b', 'i1'],
          ['/c', 'x'],
        ]),
      ]
    );

    it('shows the net, not the bundle, for a connection link', async () => {
      await openApp(fan, TO_B);
      fireEvent.click(screen.getByTestId(`edge:${TO_B}`));
      fireEvent.click(details().getAllByRole('button', { name: /^o → i/ })[0]);
      expect(details().queryByText('Bus bundle')).toBeNull();
      expect(details().getByRole('heading', { name: 'n' })).toBeInTheDocument();
    }, 20000);

    it('shows the net on the plain wire after a bundle click and a pane click', async () => {
      await openApp(fan, TO_B);
      fireEvent.click(screen.getByTestId(`edge:${TO_B}`));
      expect(details().getByText('Bus bundle')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('pane'));
      fireEvent.click(screen.getByTestId('edge:/::n#3'));
      expect(details().queryByText('Bus bundle')).toBeNull();
      expect(details().getByRole('heading', { name: 'n' })).toBeInTheDocument();
    }, 20000);
  });
});
