import type { DiagramFlowEdge } from '../../../../webview/systemDiagram/layout/elkLayout';
import { highlightedPinsByNode } from '../../../../webview/systemDiagram/pinHighlight';

const edge = (netId: string, source: string, sh: string, target: string, th: string) =>
  ({
    id: `${netId}#0`,
    type: 'elk',
    source,
    target,
    sourceHandle: sh,
    targetHandle: th,
    data: { netId, points: [], category: 'signal', isInterface: false },
  }) as DiagramFlowEdge;

describe('highlightedPinsByNode', () => {
  it('collects the endpoints of the selected net only', () => {
    const pins = highlightedPinsByNode(
      'n1',
      [edge('n1', '/a', 'out', '/b', 'in'), edge('n2', '/a', 'x', '/c', 'y')],
      []
    );
    expect([...pins.entries()].map(([id, set]) => [id, [...set]])).toEqual([
      ['/a', ['out']],
      ['/b', ['in']],
    ]);
  });

  it('includes pins that show the net as a badge', () => {
    const pins = highlightedPinsByNode(
      'clk',
      [],
      [
        {
          id: '/a',
          type: 'instance',
          data: {
            west: [{ name: 'aclk', badge: { nets: [{ id: 'clk' }] } }],
            east: [{ name: 'q' }],
          },
        } as never,
        {
          id: '::p',
          type: 'boundary',
          data: { pin: { name: 'p' }, badge: { nets: [{ id: 'clk' }] } },
        } as never,
      ]
    );
    expect([...(pins.get('/a') ?? [])]).toEqual(['aclk']);
    expect([...(pins.get('::p') ?? [])]).toEqual(['p']);
  });

  it('includes the badge pins of an expanded block frame', () => {
    const pins = highlightedPinsByNode(
      'clk',
      [edge('clk', '/a', 'out', '/frame', 'aclk')],
      [
        {
          id: '/frame',
          type: 'frame',
          data: {
            west: [{ name: 'aclk', y: 60 }],
            east: [{ name: 'rst', y: 80, badge: { nets: [{ id: 'clk' }] } }],
          },
        } as never,
      ]
    );
    expect([...(pins.get('/frame') ?? [])].sort()).toEqual(['aclk', 'rst']);
  });

  it('collects the endpoints of every net of a set, such as a clock tree', () => {
    const pins = highlightedPinsByNode(
      new Set(['n1', 'n3']),
      [
        edge('n1', '/a', 'out', '/b', 'in'),
        edge('n2', '/a', 'x', '/c', 'y'),
        edge('n3', '/d', 'q', '/b', 'in2'),
      ],
      [
        {
          id: '/e',
          type: 'instance',
          data: { west: [{ name: 'aclk', badge: { nets: [{ id: 'n3' }] } }], east: [] },
        } as never,
      ]
    );
    expect([...pins.entries()].map(([id, set]) => [id, [...set].sort()]).sort()).toEqual([
      ['/a', ['out']],
      ['/b', ['in', 'in2']],
      ['/d', ['q']],
      ['/e', ['aclk']],
    ]);
  });
});
