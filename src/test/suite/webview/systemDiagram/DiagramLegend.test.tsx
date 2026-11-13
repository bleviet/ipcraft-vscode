import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { ChangeLegend } from '../../../../webview/systemDiagram/changeDecor';
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
        measured: { width: 0, height: 0 },
        handles: [],
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
        measured: { width: 0, height: 0 },
        handles: [],
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

describe('DiagramLegend comparison entries', () => {
  function withChanges(changes: ChangeLegend | null, onOpenChanges = jest.fn()) {
    render(
      <ReactFlowProvider>
        <DiagramLegend
          edges={[]}
          nodes={[]}
          review={false}
          changes={changes}
          onOpenChanges={onOpenChanges}
        />
      </ReactFlowProvider>
    );
    return onOpenChanges;
  }

  it('lists the kinds present, each with a swatch in its color, in the order of the Changes tab', () => {
    withChanges({ kinds: ['added', 'changed', 'version'], newWire: false, removed: 0 });
    const legend = screen.getByLabelText('Legend');
    expect(legend).toHaveTextContent('+ Added');
    expect(legend).toHaveTextContent('~ Changed');
    expect(legend).toHaveTextContent('v Version only');
    expect(legend).not.toHaveTextContent('Renamed');
    expect(legend).not.toHaveTextContent('New wire');
    expect(legend.querySelectorAll('.sd-legend-swatch')).toHaveLength(3);
    expect(legend.querySelector('.sd-legend-swatch')).toHaveAttribute('data-change', 'added');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lists a new wire, and the removed entry as a button that opens the Changes tab', () => {
    const onOpenChanges = withChanges({ kinds: [], newWire: true, removed: 3 });
    expect(screen.getByLabelText('Legend')).toHaveTextContent('New wire');
    fireEvent.click(screen.getByRole('button', { name: '− 3 removed, see Changes' }));
    expect(onOpenChanges).toHaveBeenCalledTimes(1);
  });

  it('draws nothing for a level with nothing to say, or while the marks are off', () => {
    withChanges({ kinds: [], newWire: false, removed: 0 });
    expect(screen.queryByLabelText('Legend')).toBeNull();
  });
});
