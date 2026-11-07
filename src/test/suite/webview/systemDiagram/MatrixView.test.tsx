import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SystemDiagramApp } from '../../../../webview/systemDiagram/SystemDiagramApp';
import type { SystemDiagramToWebviewMessage } from '../../../../shared/messages/systemDiagram';
import { archGraph } from './archGraph';

// The Matrix toggle replaces the diagram with a table of the level; opening it never re-runs the
// layout. ELK runs for real; React Flow is mocked.
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

const matrixToggle = () => screen.getByRole('button', { name: 'Matrix' });
const matrix = () => screen.queryByRole('region', { name: 'Connectivity matrix' });
const details = () => within(screen.getByRole('complementary', { name: 'Details' }));
const placement = () => JSON.stringify(mockFlow!.nodes.map(({ id, position }) => [id, position]));

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.allSettled(mockLayoutRuns);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

beforeEach(async () => {
  mockLayoutRuns = [];
  mockFlow = null;
  mockFitBounds.mockClear();
  render(<SystemDiagramApp />);
  const message: SystemDiagramToWebviewMessage = { type: 'graph', graph: archGraph() };
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
  await waitFor(() => expect(mockFlow?.nodes.length).toBeGreaterThan(0), { timeout: 10000 });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle Details' }));
  await settle();
  mockFitBounds.mockClear();
}, 20000);

describe('the connectivity matrix', () => {
  it('opens and closes with the toolbar toggle, without a new layout', async () => {
    const runs = mockLayoutRuns.length;
    const before = placement();
    fireEvent.click(matrixToggle());
    expect(matrix()).toBeInTheDocument();
    expect(matrixToggle()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(matrixToggle());
    expect(matrix()).not.toBeInTheDocument();
    await settle();
    expect(mockLayoutRuns).toHaveLength(runs);
    expect(placement()).toEqual(before);
    expect(mockFitBounds).not.toHaveBeenCalled();
  }, 20000);

  it('keeps the diagram mounted below the matrix', () => {
    fireEvent.click(matrixToggle());
    expect(mockFlow!.nodes.length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Fit' })).toBeInTheDocument();
  });

  it('names a cell by its row, column and counts', () => {
    fireEvent.click(matrixToggle());
    const cell = within(matrix()!).getByRole('button', {
      name: 'src to dst: 3 AXIS, 1 AXI, 1 IRQ',
    });
    expect(cell).toHaveTextContent('3 AXIS');
    expect(within(matrix()!).queryByRole('button', { name: /^dst to src/ })).toBeNull();
  });

  it('isolates the pair and closes on a cell click', async () => {
    fireEvent.click(matrixToggle());
    fireEvent.click(
      within(matrix()!).getByRole('button', { name: 'src to dst: 3 AXIS, 1 AXI, 1 IRQ' })
    );
    expect(matrix()).not.toBeInTheDocument();
    await settle();
    expect(screen.getByText('Pair · src ↔ dst')).toBeInTheDocument();
    expect(mockFlow!.nodes.map((node) => node.id).sort()).toEqual(['/dst', '/src']);
  }, 20000);

  it('selects the node and closes on a header click', async () => {
    fireEvent.click(matrixToggle());
    fireEvent.click(within(matrix()!).getByRole('button', { name: 'Select dst (row)' }));
    expect(matrix()).not.toBeInTheDocument();
    await settle();
    expect(details().getByRole('heading', { name: /dst/ })).toBeInTheDocument();
  }, 20000);

  it('closes on Escape inside the matrix', () => {
    fireEvent.click(matrixToggle());
    expect(matrix()).toHaveFocus();
    fireEvent.keyDown(matrix()!, { key: 'Escape' });
    expect(matrix()).not.toBeInTheDocument();
  });

  it('hands the focus back to the toggle when it closes from inside', () => {
    fireEvent.click(matrixToggle());
    fireEvent.keyDown(matrix()!, { key: 'Escape' });
    expect(matrixToggle()).toHaveFocus();
  });

  it('closes when an outline row is clicked', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Outline' }));
    fireEvent.click(matrixToggle());
    const outline = within(screen.getByRole('navigation', { name: 'Design outline' }));
    fireEvent.click(outline.getByRole('button', { name: 'dst' }));
    expect(matrix()).not.toBeInTheDocument();
  });

  it('closes on a search step', () => {
    fireEvent.click(matrixToggle());
    const search = screen.getByLabelText('Search instances');
    fireEvent.change(search, { target: { value: 'dst' } });
    expect(matrix()).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(matrix()).not.toBeInTheDocument();
  });
});
