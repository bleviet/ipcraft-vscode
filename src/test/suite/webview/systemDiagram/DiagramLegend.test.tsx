import React from 'react';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { DiagramLegend } from '../../../../webview/systemDiagram/DiagramLegend';
import type { DiagramFlowNode } from '../../../../webview/systemDiagram/layout/elkLayout';

const net = { id: 'n', name: 'n', category: 'clock' as const };
const row = { name: 'aclk', y: 60, badge: { nets: [net] } };

function legendFor(nodes: DiagramFlowNode[]) {
  render(
    <ReactFlowProvider>
      <DiagramLegend edges={[]} nodes={nodes} review={false} />
    </ReactFlowProvider>
  );
}

describe('DiagramLegend badges', () => {
  it('lists the clock and reset badges of the pins of a frame', () => {
    legendFor([
      {
        id: '/frame',
        type: 'frame',
        position: { x: 0, y: 0 },
        width: 400,
        height: 300,
        draggable: false,
        data: { instance: {} as never, cellCount: 3, west: [row as never], east: [] },
      },
    ]);
    expect(screen.getByLabelText('Legend')).toHaveTextContent('Clock');
  });

  it('draws no legend for a frame without badges or wires', () => {
    legendFor([
      {
        id: '/frame',
        type: 'frame',
        position: { x: 0, y: 0 },
        width: 400,
        height: 300,
        draggable: false,
        data: {
          instance: {} as never,
          cellCount: 3,
          west: [{ name: 'a', y: 1 } as never],
          east: [],
        },
      },
    ]);
    expect(screen.queryByLabelText('Legend')).toBeNull();
  });
});
