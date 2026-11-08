import type { DiagramFlowEdge } from '../../../../webview/systemDiagram/layout/elkLayout';
import {
  badgedNodeIds,
  highlightedPinsByNode,
} from '../../../../webview/systemDiagram/pinHighlight';

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

describe('badgedNodeIds', () => {
  const badge = (...ids: string[]) => ({ nets: ids.map((id) => ({ id })) });
  const nodes = [
    { id: '/west', type: 'instance', data: { west: [{ badge: badge('clk') }], east: [{}] } },
    { id: '/east', type: 'instance', data: { west: [{}], east: [{ badge: badge('rst', 'clk') }] } },
    { id: '/frame', type: 'frame', data: { west: [], east: [{ badge: badge('clk') }] } },
    { id: '/other', type: 'instance', data: { west: [{ badge: badge('rst') }], east: [] } },
    { id: '/none', type: 'instance', data: { west: [{}], east: [{}] } },
    { id: '::port', type: 'boundary', data: { badge: badge('clk') } },
    { id: '::plain', type: 'boundary', data: {} },
  ] as never[];

  it('lists the nodes with a badge on a selected net, in every kind of node', () => {
    expect([...badgedNodeIds(new Set(['clk']), nodes)]).toEqual([
      '/west',
      '/east',
      '/frame',
      '::port',
    ]);
    expect([...badgedNodeIds(new Set(['rst']), nodes)]).toEqual(['/east', '/other']);
  });

  it('lists nothing for an empty selection or an unrelated net', () => {
    expect(badgedNodeIds(new Set(), nodes).size).toBe(0);
    expect(badgedNodeIds(new Set(['other']), nodes).size).toBe(0);
  });
});
