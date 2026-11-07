import React from 'react';
import { render } from '@testing-library/react';
import type { EdgeProps } from '@xyflow/react';
import { ElkEdge, type ElkFlowEdge } from '../../../../webview/systemDiagram/ElkEdge';
import type { ElkEdgeData } from '../../../../webview/systemDiagram/layout/elkLayout';

const data = (over: Partial<ElkEdgeData> = {}): ElkEdgeData => ({
  points: [
    { x: 0, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 30 },
    { x: 120, y: 30 },
  ],
  netId: 'n1',
  category: 'axis',
  isInterface: true,
  ...over,
});

function draw(edgeData: ElkEdgeData, selected = false) {
  const props = { id: 'e1', data: edgeData, selected } as unknown as EdgeProps<ElkFlowEdge>;
  return render(
    <svg>
      <ElkEdge {...props} />
    </svg>
  );
}

describe('ElkEdge', () => {
  it('draws a plain wire as one path without a badge', () => {
    const { container } = draw(data());
    expect(container.querySelector('.react-flow__edge-path')).toHaveAttribute(
      'd',
      'M 0 10 L 20 10 L 20 30 L 120 30'
    );
    expect(container.querySelector('.sd-bundle-badge')).toBeNull();
  });

  it('draws a bundle as the trunk plus a subpath per branch, with its count badge', () => {
    const { container } = draw(
      data({
        bundle: {
          key: 'bundle:x',
          label: '×3 AXIS',
          members: [],
          branches: [
            [
              { x: 5, y: 0 },
              { x: 8, y: 0 },
              { x: 8, y: 10 },
            ],
          ],
        },
      })
    );
    expect(container.querySelector('.react-flow__edge-path')).toHaveAttribute(
      'd',
      'M 0 10 L 20 10 L 20 30 L 120 30 M 5 0 L 8 0 L 8 10'
    );
    const badge = container.querySelector('.sd-bundle-badge')!;
    expect(badge.querySelector('text')).toHaveTextContent('×3 AXIS');
    // Centred on the middle of the longest segment: (20,30)-(120,30).
    expect(badge.querySelector('text')).toHaveAttribute('x', '70');
    expect(badge.querySelector('text')).toHaveAttribute('y', '30');
  });
});
