import type { SystemGraph } from '../../../../domain/systemGraph';
import {
  buildElkInput,
  toFlowElements,
  type DiagramFlowNode,
} from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { withUnion, type Ghosts } from '../../../../webview/systemDiagram/layout/unionGraph';
import { zynqGraph, zynqUnion } from './compareFixtures';
import { fakeMeasure } from './fixtureGraph';
import { systemBd, withoutGpioBlock } from './systemBdEdit';

const instanceRows = (node: DiagramFlowNode | undefined) =>
  node && node.type !== 'boundary' ? [...node.data.west, ...node.data.east] : [];

async function layout(graph: SystemGraph, ghosts?: Ghosts, expanded: string[] = []) {
  const input = buildElkInput(graph, '/', { measure: fakeMeasure, expanded: new Set(expanded) });
  const laidOut = await runElkLayout(input);
  return { input, ...toFlowElements(laidOut, graph, '/', fakeMeasure, undefined, ghosts) };
}

describe('the layout of a comparison with ghosts', () => {
  const current = zynqGraph('current');
  const merged = withUnion(current, zynqUnion());
  let plain: Awaited<ReturnType<typeof layout>>;
  let union: Awaited<ReturnType<typeof layout>>;
  beforeAll(async () => {
    plain = await layout(current);
    union = await layout(merged.graph, merged.ghosts);
  }, 20000);

  it('lays out the ghost block, the ghost port and the ghost wire with the rest', () => {
    const ids = union.nodes.map((node) => node.id);
    expect(ids).toEqual(expect.arrayContaining(['/axi_gpio_0', '/::led_o']));
    expect(plain.nodes.map((node) => node.id)).not.toContain('/axi_gpio_0');
    expect(union.input.children?.map((child) => child.id)).toContain('/axi_gpio_0');
    const wire = union.edges.filter((edge) => edge.data.netId === 'ghost:/::periph_gpio0');
    expect(wire).toHaveLength(1);
    expect([wire[0].source, wire[0].target].sort()).toEqual(['/axi_gpio_0', '/axi_periph']);
  });

  it('keeps the other nodes and wires as the open design has them: same data, no ghost net on a pin', () => {
    for (const node of plain.nodes) {
      const other = union.nodes.find((candidate) => candidate.id === node.id)!;
      const [a, b] = [instanceRows(node), instanceRows(other)];
      // The only difference of a node of the design is the row of a ghost pin.
      expect(b.filter((row) => row.ghost !== true)).toEqual(a);
    }
    expect(
      union.edges
        .filter((e) => !e.data.netId.startsWith('ghost:'))
        .map((e) => e.id)
        .sort()
    ).toEqual(plain.edges.map((e) => e.id).sort());
  });

  it('flags the pin only the base has, which is connected only by the ghost wire', () => {
    const rows = instanceRows(union.nodes.find((node) => node.id === '/axi_periph'));
    const ghost = rows.find((row) => row.name === 'M00_AXI')!;
    expect(ghost.ghost).toBe(true);
    expect(ghost.netNames).toEqual(['periph_gpio0']);
    expect(rows.filter((row) => row.ghost)).toHaveLength(1);
    expect(rows.find((row) => row.name === 'S00_AXI')?.ghost).toBeUndefined();
  });

  it('counts the cells of a level without its ghosts', () => {
    const cells = (nodes: DiagramFlowNode[], id: string) => {
      const node = nodes.find((candidate) => candidate.id === id)!;
      return node.type === 'boundary' ? undefined : node.data.cellCount;
    };
    expect(cells(union.nodes, '/gpio_block')).toBe(cells(plain.nodes, '/gpio_block'));
  });

  it('is the same layout without a comparison: the ghost argument defaults to none', async () => {
    const again = await layout(current, undefined);
    expect(again.nodes).toEqual(plain.nodes);
    expect(again.edges).toEqual(plain.edges);
  });
});

describe('a pin only the base has on a hierarchy shown expanded', () => {
  it('is a ghost row of its frame, and the cells of the frame are those of the design', async () => {
    const now = zynqGraph('current');
    const pin = { ...now.instances['/gpio_block'].pins[0], name: 'gone', direction: 'in' as const };
    const merged = withUnion(now, {
      instances: [],
      pins: [{ instance: '/gpio_block', pin }],
      boundaryPins: [],
      nets: [],
    });
    const { nodes } = await layout(merged.graph, merged.ghosts, ['/gpio_block']);
    const frame = nodes.find((node) => node.id === '/gpio_block');
    expect(frame?.type).toBe('frame');
    expect(instanceRows(frame).find((row) => row.name === 'gone')?.ghost).toBe(true);
    expect(instanceRows(frame).filter((row) => row.ghost)).toHaveLength(1);
    expect(frame?.type === 'frame' && frame.data.cellCount).toBe(
      now.levels['/gpio_block'].instances.length
    );
  }, 20000);
});

describe('the ghost of a removed hierarchy', () => {
  it('is one block, laid out like any other block of the level', async () => {
    const [base, now] = [systemBd(), systemBd(withoutGpioBlock)];
    const { unionAdditions } =
      await import('../../../../services/systemDiagram/diff/unionAdditions');
    const { diffSystemGraphs } =
      await import('../../../../services/systemDiagram/diff/diffSystemGraphs');
    const merged = withUnion(now, unionAdditions(base, now, diffSystemGraphs(base, now)));
    const { nodes, edges } = await layout(merged.graph, merged.ghosts);
    expect(nodes.find((node) => node.id === '/gpio_block')?.type).toBe('instance');
    expect(edges.some((edge) => edge.data.netId.startsWith('ghost:'))).toBe(true);
  }, 20000);
});
