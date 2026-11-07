import {
  ARCH_EAST,
  ARCH_WEST,
  archLayout,
  archPills,
  archPinPorts,
  archPortCentres,
  archPorts,
  hierarchyPreview,
} from '../../../../webview/systemDiagram/layout/archCard';
import { netsByEndpoint } from '../../../../webview/systemDiagram/model';
import { designOf, instance, net } from './bundlingGraph';
import { archGraph } from './archGraph';
import { pin } from './foldingGraph';

const graph = archGraph();
const nets = netsByEndpoint(graph, '/');

describe('archPills', () => {
  it('counts connected pins per category, clock excluded, most pins first', () => {
    const { pills, more } = archPills(graph.instances['/src'], nets);
    expect(pills.map((p) => p.label)).toEqual(['3× AXIS', '1× AXI', '1× IRQ']);
    expect(more).toBe(0);
  });

  it('keeps legend order among equal counts and sums up the rest as +N', () => {
    const wide = instance(
      'wide',
      ['m_a', 'm_b', 'm_c', 'm_d'].map((name) => pin(name, 'master', true))
    );
    const peers = ['aximm', 'axis', 'avalonmm', 'avalonst'] as const;
    const design = designOf(
      [wide, ...peers.map((c) => instance(c, [pin('s', 'slave', true)]))],
      peers.map((category, i) =>
        net(`n${i}`, category, [
          ['/wide', ['m_a', 'm_b', 'm_c', 'm_d'][i]],
          [`/${category}`, 's'],
        ])
      )
    );
    const { pills, more } = archPills(design.instances['/wide'], netsByEndpoint(design, '/'));
    expect(pills.map((p) => p.label)).toEqual(['1× AXI', '1× AXIS', '1× AVMM']);
    expect(more).toBe(1);
  });

  it('draws no pill for reset and clock nets', () => {
    const block = instance('blk', [pin('rst', 'in'), pin('clk', 'in')]);
    const peer = instance('peer', [pin('rst', 'out'), pin('clk', 'out')]);
    const design = designOf(
      [block, peer],
      [
        net('r', 'reset', [
          ['/peer', 'rst'],
          ['/blk', 'rst'],
        ]),
        net('c', 'clock', [
          ['/peer', 'clk'],
          ['/blk', 'clk'],
        ]),
      ]
    );
    expect(archPills(block, netsByEndpoint(design, '/'))).toEqual({ pills: [], more: 0 });
  });

  it('shows no pill for a block whose pins are all unconnected', () => {
    const lonely = instance('lonely', [pin('a', 'in', true)]);
    const design = designOf([lonely], []);
    expect(archPills(lonely, netsByEndpoint(design, '/'))).toEqual({ pills: [], more: 0 });
  });
});

describe('hierarchyPreview', () => {
  it('joins the first three names in signal order and counts the rest', () => {
    expect(hierarchyPreview(graph, graph.instances['/sub'])).toBe('a → b → c +1');
  });

  it('has no preview for an empty level or a block that is not a hierarchy', () => {
    const empty = instance('empty', [], 'hier');
    const design = designOf([empty], [], {
      '/': { path: '/', name: 'd', boundaryPins: [], instances: [empty.path] },
      '/empty': { path: '/empty', name: 'empty', boundaryPins: [], instances: [] },
    });
    expect(hierarchyPreview(design, empty)).toBeUndefined();
    expect(hierarchyPreview(graph, graph.instances['/src'])).toBeUndefined();
  });

  it('shows all names without a count when there are three or fewer', () => {
    const small = designOf(
      [instance('h', [], 'hier'), instance('q', [pin('o', 'out')], 'ip', '/h')],
      [],
      {
        '/': { path: '/', name: 'd', boundaryPins: [], instances: ['/h'] },
        '/h': { path: '/h', name: 'h', boundaryPins: [], instances: ['/h/q'] },
      }
    );
    expect(hierarchyPreview(small, small.instances['/h'])).toBe('q');
  });
});

describe('the card of an instance', () => {
  const src = graph.instances['/src'];
  const card = archLayout(graph, src, nets);

  it('has the fixed heights: header, pill row, padding, and a preview line for a hierarchy', () => {
    expect(card.height).toBe(42 + 22 + 8);
    expect(archLayout(graph, graph.instances['/sub'], nets).height).toBe(42 + 22 + 18 + 8);
  });

  it('has one centred port per side with pins', () => {
    const ports = archPorts('/src', card, 200);
    expect(ports.map((port) => port.id)).toEqual([`/src::${ARCH_WEST}`, `/src::${ARCH_EAST}`]);
    expect(ports.every((port) => port.y === (card.height - 8) / 2)).toBe(true);
    expect(ports.map((port) => port.x)).toEqual([-4, 196]);
    expect([...archPortCentres(card).keys()]).toEqual([ARCH_WEST, ARCH_EAST]);
  });

  it('has no port on a side without pins, and no `::` or pin name in the port names', () => {
    const sub = archLayout(graph, graph.instances['/sub'], nets);
    expect(archPorts('/sub', sub, 180).map((port) => port.id)).toEqual([`/sub::${ARCH_WEST}`]);
    for (const name of [ARCH_WEST, ARCH_EAST]) {
      expect(name).not.toContain('::');
      expect(src.pins.map((p) => p.name)).not.toContain(name);
    }
  });

  it('maps every pin to the port of its side', () => {
    const ports = archPinPorts('/src', card);
    expect(ports.get('/src::clk')).toBe(`/src::${ARCH_WEST}`);
    expect(ports.get('/src::m_a')).toBe(`/src::${ARCH_EAST}`);
    expect(ports.get('/src::irq')).toBe(`/src::${ARCH_EAST}`);
    expect(ports.size).toBe(src.pins.length);
  });
});
