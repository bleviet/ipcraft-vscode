import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SystemDiagramApp } from '../../../../webview/systemDiagram/SystemDiagramApp';
import type { SystemDiagramToWebviewMessage } from '../../../../shared/messages/systemDiagram';
import { foldingGraph } from './foldingGraph';

// The pin mode is a layout input: changing it, or opening a group, re-runs ELK. The Clocks and
// resets and Unconnected pins toggles do not. ELK runs for real; React Flow is mocked.
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
interface FlowProps {
  nodes: FlowNode[];
  nodeTypes: Record<string, React.ComponentType<{ data: unknown }>>;
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

const compactPins = () => screen.getByRole('button', { name: 'Compact' });
const fullPins = () => screen.getByRole('button', { name: 'Full pins' });
const groupRow = () => screen.queryByRole('button', { name: /M00\.\.M27_AXI \[28\]/ });
const hubHeight = () => mockFlow!.nodes.find((node) => node.id === '/hub')!.height;

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.allSettled(mockLayoutRuns);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

beforeEach(async () => {
  mockLayoutRuns = [];
  mockFlow = null;
  render(<SystemDiagramApp />);
  const message: SystemDiagramToWebviewMessage = { type: 'graph', graph: foldingGraph() };
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
  await screen.findByRole('button', { name: /M00\.\.M27_AXI \[28\]/ }, { timeout: 10000 });
  await settle();
  mockFitBounds.mockClear();
});

describe('the Compact pin mode', () => {
  it('is on by default and folds the array into one row', () => {
    expect(compactPins()).toHaveAttribute('aria-pressed', 'true');
    expect(groupRow()).not.toBeNull();
    expect(screen.queryByText('M05_AXI')).toBeNull();
  }, 20000);

  it('lays out again with every pin on its own row when switched off, and folds back on', async () => {
    const folded = hubHeight();
    const runs = mockLayoutRuns.length;
    fireEvent.click(fullPins());
    await settle();
    expect(mockLayoutRuns.length).toBeGreaterThan(runs);
    expect(fullPins()).toHaveAttribute('aria-pressed', 'true');
    expect(compactPins()).toHaveAttribute('aria-pressed', 'false');
    expect(groupRow()).toBeNull();
    expect(screen.getByText('M05_AXI')).toBeInTheDocument();
    expect(screen.getByText('M27_AXI')).toBeInTheDocument();
    expect(hubHeight()).toBeGreaterThan(folded);
    fireEvent.click(compactPins());
    await settle();
    expect(groupRow()).not.toBeNull();
    expect(hubHeight()).toBe(folded);
    expect(mockFitBounds).not.toHaveBeenCalled();
  }, 20000);

  it('expands one array on a click of its row and folds it on a click of the header', async () => {
    const folded = hubHeight();
    fireEvent.click(groupRow()!);
    await settle();
    expect(groupRow()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('M05_AXI')).toBeInTheDocument();
    expect(hubHeight()).toBeGreaterThan(folded);
    fireEvent.click(groupRow()!);
    await settle();
    expect(groupRow()).toHaveAttribute('aria-expanded', 'false');
    expect(hubHeight()).toBe(folded);
    expect(mockFitBounds).not.toHaveBeenCalled();
  }, 20000);

  it('is not moved by the Clocks and resets or Unconnected pins toggles', async () => {
    const before = JSON.stringify(
      mockFlow!.nodes.map(({ id, position, height }) => [id, position, height])
    );
    const runs = mockLayoutRuns.length;
    fireEvent.click(screen.getByRole('button', { name: 'Clocks and resets' }));
    fireEvent.click(screen.getByRole('button', { name: /^Unconnected pins/ }));
    await settle();
    expect(mockLayoutRuns).toHaveLength(runs);
    expect(groupRow()).not.toBeNull();
    expect(
      JSON.stringify(mockFlow!.nodes.map(({ id, position, height }) => [id, position, height]))
    ).toBe(before);
  }, 20000);
});
