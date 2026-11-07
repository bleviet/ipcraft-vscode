import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SystemDiagramApp } from '../../../../webview/systemDiagram/SystemDiagramApp';
import type { SystemDiagramToWebviewMessage } from '../../../../shared/messages/systemDiagram';
import { foldingGraph } from './foldingGraph';

// Arch is a pin mode (a layout input); Auto detail is not. ELK runs for real; React Flow is mocked.
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

const mode = (name: string) => screen.getByRole('button', { name });
const hub = () => mockFlow!.nodes.find((node) => node.id === '/hub')!;
const geometry = () =>
  JSON.stringify(
    mockFlow!.nodes.map(({ id, position, width, height }) => [id, position, width, height])
  );

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

describe('the pin detail control', () => {
  it('offers Arch, Compact and Full pins as one group, Compact pressed', () => {
    const group = screen.getByRole('group', { name: 'Pin detail' });
    expect(group).toContainElement(mode('Arch'));
    expect(group).toContainElement(mode('Compact'));
    expect(group).toContainElement(mode('Full pins'));
    expect(mode('Compact')).toHaveAttribute('aria-pressed', 'true');
    expect(mode('Arch')).toHaveAttribute('aria-pressed', 'false');
    expect(mode('Full pins')).toHaveAttribute('aria-pressed', 'false');
  }, 20000);

  it('draws cards with pills and no pin rows in Arch, and the rows again in Compact', async () => {
    const compactHeight = hub().height;
    const runs = mockLayoutRuns.length;
    fireEvent.click(mode('Arch'));
    await settle();
    expect(mockLayoutRuns.length).toBeGreaterThan(runs);
    expect(mode('Arch')).toHaveAttribute('aria-pressed', 'true');
    expect(mode('Compact')).toHaveAttribute('aria-pressed', 'false');
    expect(hub().height).toBe(42 + 22 + 8);
    expect(screen.getAllByText('28× AXI').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /M00\.\.M27_AXI/ })).toBeNull();
    expect(screen.queryByText('aclk')).toBeNull();
    expect(mockFitBounds).not.toHaveBeenCalled();

    fireEvent.click(mode('Compact'));
    await settle();
    expect(hub().height).toBe(compactHeight);
    expect(screen.queryByRole('button', { name: /M00\.\.M27_AXI/ })).not.toBeNull();
  }, 20000);
});

describe('the Auto toggle', () => {
  it('is on by default and changes neither the layout nor any node size', async () => {
    const auto = mode('Auto');
    expect(auto).toHaveAttribute('aria-pressed', 'true');
    const before = geometry();
    const runs = mockLayoutRuns.length;
    fireEvent.click(auto);
    await settle();
    expect(auto).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(auto);
    await settle();
    expect(auto).toHaveAttribute('aria-pressed', 'true');
    expect(mockLayoutRuns).toHaveLength(runs);
    expect(geometry()).toBe(before);
    expect(mockFitBounds).not.toHaveBeenCalled();
  }, 20000);
});
