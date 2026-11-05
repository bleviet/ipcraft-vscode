import type { DiagramFlowNode } from '../../../../webview/systemDiagram/layout/elkLayout';
import { nodeCenter } from '../../../../webview/systemDiagram/layout/nodeCenter';

const node = (
  id: string,
  type: 'instance' | 'boundary',
  x: number,
  y: number,
  w: number,
  h: number
) =>
  ({
    id,
    type,
    position: { x, y },
    width: w,
    height: h,
    draggable: false,
    data: {},
  }) as unknown as DiagramFlowNode;

describe('nodeCenter', () => {
  const layout = {
    nodes: [node('/a', 'instance', 100, 40, 240, 110), node('/::ext', 'boundary', -20, 5, 150, 26)],
  };

  it('centres instance and boundary nodes', () => {
    expect(nodeCenter(layout, '/a')).toEqual({ x: 220, y: 95 });
    expect(nodeCenter(layout, '/::ext')).toEqual({ x: 55, y: 18 });
  });

  it('is null for unknown nodes', () => {
    expect(nodeCenter(layout, '/missing')).toBeNull();
  });
});
