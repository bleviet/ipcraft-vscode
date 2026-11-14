import type { SystemInstance, SystemNet, SystemPin } from '../../../../domain/systemGraph';
import type { UnionAdditions } from '../../../../domain/systemGraphDiff';
import {
  isGhostNode,
  layoutNetsByEndpoint,
  NO_GHOSTS,
  openCellCount,
  withoutGhosts,
  withUnion,
} from '../../../../webview/systemDiagram/layout/unionGraph';
import type {
  DiagramFlowEdge,
  DiagramFlowNode,
} from '../../../../webview/systemDiagram/layout/elkLayout';
import { zynqGraph, zynqUnion } from './compareFixtures';

const current = zynqGraph('current');
const union = zynqUnion();

describe('withUnion', () => {
  it('is the graph itself, without ghosts, when there is nothing to add', () => {
    const none: UnionAdditions = { instances: [], pins: [], boundaryPins: [], nets: [] };
    for (const additions of [undefined, none]) {
      const merged = withUnion(current, additions);
      expect(merged.graph).toBe(current);
      expect(merged.ghosts).toBe(NO_GHOSTS);
    }
  });

  it('merges the ghost block into its level, its pin and port, and its wire, and says which are ghosts', () => {
    const { graph, ghosts } = withUnion(current, union);
    expect(graph.instances['/axi_gpio_0']).toBeDefined();
    expect(graph.levels['/'].instances).toEqual([...current.levels['/'].instances, '/axi_gpio_0']);
    expect(graph.levels['/'].boundaryPins.map((p) => p.name)).toContain('led_o');
    expect(graph.instances['/axi_periph'].pins.map((p) => p.name)).toContain('M00_AXI');
    expect(graph.nets).toHaveLength(current.nets.length + 1);
    expect([...ghosts.instances]).toEqual(['/axi_gpio_0']);
    expect([...(ghosts.pins.get('/axi_periph') ?? [])]).toEqual(['M00_AXI']);
    expect([...ghosts.boundary]).toEqual(['/::led_o']);
    expect([...ghosts.nets]).toEqual(['ghost:/::periph_gpio0']);
  });

  it('leaves the current graph as it was', () => {
    const before = JSON.stringify(current);
    withUnion(current, union);
    expect(JSON.stringify(current)).toBe(before);
    expect(current.instances['/axi_gpio_0']).toBeUndefined();
  });

  it('leaves out what does not fit: a level or block the graph lacks, a path or pin it has', () => {
    const ghost: SystemInstance = { ...union.instances[0], path: '/x/y', name: 'y', parent: '/x' };
    const known: SystemInstance = { ...union.instances[0], path: '/sys_ps7', name: 'sys_ps7' };
    const pin = (name: string): SystemPin => ({ ...union.pins[0].pin, name });
    const net: SystemNet = { ...union.nets[0], id: 'ghost:/x::n', level: '/x' };
    const { graph, ghosts } = withUnion(current, {
      instances: [ghost, known],
      pins: [
        { instance: '/missing', pin: pin('p') },
        { instance: '/sys_ps7', pin: current.instances['/sys_ps7'].pins[0] },
      ],
      boundaryPins: [{ level: '/nowhere', pin: pin('q') }],
      nets: [net],
    });
    expect(graph.instances['/x/y']).toBeUndefined();
    expect(graph.instances['/sys_ps7']).toBe(current.instances['/sys_ps7']);
    expect(graph.nets).toHaveLength(current.nets.length);
    expect(ghosts.instances.size + ghosts.pins.size + ghosts.boundary.size + ghosts.nets.size).toBe(
      0
    );
  });
});

describe('layoutNetsByEndpoint', () => {
  const { graph, ghosts } = withUnion(current, union);

  it('puts a ghost net on the pins only the base has, not on the pins of the current graph', () => {
    const lookup = layoutNetsByEndpoint(graph, '/', ghosts);
    const ghostNet = 'ghost:/::periph_gpio0';
    expect(lookup.get('/axi_gpio_0::S_AXI')?.map((n) => n.id)).toEqual([ghostNet]);
    expect(lookup.get('/axi_periph::M00_AXI')?.map((n) => n.id)).toEqual([ghostNet]);
    // Every other pin keeps the nets it has in the open design.
    const plain = layoutNetsByEndpoint(current, '/', NO_GHOSTS);
    for (const [key, nets] of plain) {
      expect(lookup.get(key)).toEqual(nets);
    }
  });

  it('is the plain lookup without ghosts', () => {
    expect(layoutNetsByEndpoint(graph, '/', NO_GHOSTS).size).toBeGreaterThan(0);
  });
});

describe('openCellCount', () => {
  it('does not count the ghosts of a level as its cells', () => {
    const { graph, ghosts } = withUnion(current, union);
    expect(graph.levels['/'].instances).toHaveLength(current.levels['/'].instances.length + 1);
    expect(openCellCount(graph, '/', ghosts.instances)).toBe(current.levels['/'].instances.length);
    expect(openCellCount(graph, '/nowhere', ghosts.instances)).toBe(0);
  });
});

describe('withoutGhosts', () => {
  const node = (id: string) => ({ id }) as unknown as DiagramFlowNode;
  const edge = (id: string, netId: string) =>
    ({ id, data: { netId } }) as unknown as DiagramFlowEdge;
  const { ghosts } = withUnion(current, union);
  const layout = {
    nodes: [node('/sys_ps7'), node('/axi_gpio_0'), node('/::led_o')],
    edges: [edge('a#0', '/::n'), edge('ghost:/::periph_gpio0#1', 'ghost:/::periph_gpio0')],
  };

  it('takes the ghost nodes and wires out and keeps the others as they are', () => {
    const shown = withoutGhosts(layout, ghosts);
    expect(shown.nodes.map((n) => n.id)).toEqual(['/sys_ps7']);
    expect(shown.edges.map((e) => e.id)).toEqual(['a#0']);
    expect(shown.nodes[0]).toBe(layout.nodes[0]);
  });

  it('is the layout itself without ghosts', () => {
    expect(withoutGhosts(layout, NO_GHOSTS)).toBe(layout);
  });

  it('tells a ghost node from the rest', () => {
    expect(isGhostNode(ghosts, '/axi_gpio_0')).toBe(true);
    expect(isGhostNode(ghosts, '/::led_o')).toBe(true);
    expect(isGhostNode(ghosts, '/sys_ps7')).toBe(false);
  });
});
