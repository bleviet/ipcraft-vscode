import {
  buildElkInput,
  toFlowElements,
  type InstanceNodeData,
} from '../../../../webview/systemDiagram/layout/elkLayout';
import { ARCH_EAST, ARCH_WEST } from '../../../../webview/systemDiagram/layout/archCard';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { archGraph } from './archGraph';
import { fakeMeasure } from './fixtureGraph';

const graph = archGraph();
const arch = { open: new Set<string>(), arch: true as const };
const compact = { open: new Set<string>() };
const bundling = { unbundled: new Set<string>() };

const node = (input: ReturnType<typeof buildElkInput>, id: string) =>
  input.children!.find((child) => child.id === id)!;

describe('buildElkInput with Arch cards', () => {
  const input = buildElkInput(graph, '/', { measure: fakeMeasure, pinFolding: arch });

  it('gives each block one port per side, centred, and the fixed card height', () => {
    const src = node(input, '/src');
    expect(src.ports!.map((port) => port.id)).toEqual([`/src::${ARCH_WEST}`, `/src::${ARCH_EAST}`]);
    expect(src.height).toBe(72);
    expect(src.ports!.every((port) => port.y === 32)).toBe(true);
    expect(src.ports!.every((port) => port.labels === undefined)).toBe(true);
    expect(node(input, '/sub').height).toBe(90);
    expect(node(input, '/sub').ports!.map((port) => port.id)).toEqual([`/sub::${ARCH_WEST}`]);
  });

  it('widens a card to the room its pills need, beyond the minimum width', () => {
    // 'src' has three pills; the name alone fits the minimum width of 180.
    const wide = node(input, '/src').width!;
    expect(wide).toBeGreaterThan(180);
    // 19 label characters at 7 px, two dotted pills' chrome and one more, the gaps and the padding.
    expect(wide).toBe(19 * 7 + 3 * 22 + 2 * 4 + 16 + 2);
    expect(node(input, '/dst').width).toBe(wide);
  });

  it('attaches every wire to the port of the side of its pin', () => {
    const ends = input.edges!.map((edge) => `${edge.sources[0]}>${edge.targets[0]}`);
    expect(new Set(ends)).toEqual(
      new Set([`/src::${ARCH_EAST}>/dst::${ARCH_WEST}`, `/src::${ARCH_WEST}>/dst::${ARCH_WEST}`])
    );
    // 3 streams, 1 memory-mapped, 1 interrupt east to west; the clock west to west.
    expect(ends.filter((end) => end.startsWith(`/src::${ARCH_EAST}`))).toHaveLength(5);
  });

  it('draws bundled wires as one edge per category between two cards', () => {
    const bundled = buildElkInput(graph, '/', {
      measure: fakeMeasure,
      pinFolding: arch,
      busBundling: bundling,
    });
    expect(bundled.edges!.map((edge) => edge.id).sort()).toEqual(
      ['/::axi#1', '/::clk#1', '/::irq#1', 'bundle:/src->/dst|axis|i'].sort()
    );
    const trunk = bundled.edges!.find((edge) => edge.id.startsWith('bundle:'))!;
    expect(trunk.sources).toEqual([`/src::${ARCH_EAST}`]);
    expect(trunk.targets).toEqual([`/dst::${ARCH_WEST}`]);
  });

  it('leaves the Compact input without cards', () => {
    const plain = buildElkInput(graph, '/', { measure: fakeMeasure, pinFolding: compact });
    expect(node(plain, '/src').ports!.map((port) => port.id)).toContain('/src::m_a');
    expect(node(plain, '/src').height).not.toBe(72);
    expect(JSON.stringify(plain)).not.toContain('*arch');
  });

  it('draws cards for the blocks inside an expanded block', () => {
    const expanded = buildElkInput(graph, '/', {
      measure: fakeMeasure,
      pinFolding: arch,
      expanded: new Set(['/sub']),
    });
    const inner = node(expanded, '/sub').children!.find((child) => child.id === '/sub/b')!;
    expect(inner.ports!.map((port) => port.id)).toEqual([
      `/sub/b::${ARCH_WEST}`,
      `/sub/b::${ARCH_EAST}`,
    ]);
  });
});

describe('the flow elements of Arch cards', () => {
  it('carry the summary, no pin rows, and one bundle without branches per category pair', async () => {
    const options = { measure: fakeMeasure, pinFolding: arch, busBundling: bundling };
    const laidOut = await runElkLayout(buildElkInput(graph, '/', options));
    const { nodes, edges } = toFlowElements(laidOut, graph, '/', fakeMeasure, arch, bundling);
    const src = nodes.find((n) => n.id === '/src')!.data as InstanceNodeData;
    expect(src.west).toEqual([]);
    expect(src.east).toEqual([]);
    expect(src.arch?.pills.map((pill) => pill.label)).toEqual(['3× AXIS', '1× AXI', '1× IRQ']);
    expect(nodes.find((n) => n.id === '/sub')!.height).toBe(90);
    expect((nodes.find((n) => n.id === '/sub')!.data as InstanceNodeData).arch?.preview).toBe(
      'a → b → c +1'
    );

    const bundle = edges.find((edge) => edge.data.bundle)!;
    expect(bundle.data.bundle?.label).toBe('×3 AXIS');
    expect(bundle.data.bundle?.branches).toEqual([]);
    expect(bundle.sourceHandle).toBe(ARCH_EAST);
    expect(bundle.targetHandle).toBe(ARCH_WEST);
    expect(edges.filter((edge) => edge.data.category === 'axis')).toHaveLength(1);
    expect(edges).toHaveLength(4);
  });

  it('keeps the pin rows of the Compact mode', async () => {
    const laidOut = await runElkLayout(
      buildElkInput(graph, '/', { measure: fakeMeasure, pinFolding: compact })
    );
    const { nodes } = toFlowElements(laidOut, graph, '/', fakeMeasure, compact);
    const src = nodes.find((n) => n.id === '/src')!.data as InstanceNodeData;
    expect(src.arch).toBeUndefined();
    expect(src.east.map((row) => row.name)).toContain('m_a');
  });
});
