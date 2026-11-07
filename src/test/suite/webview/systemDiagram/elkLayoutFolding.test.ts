import type { ElkNode } from 'elkjs/lib/elk-api';
import {
  buildElkInput,
  HEADER_HEIGHT,
  PIN_ROW_HEIGHT,
  toFlowElements,
  type FrameNodeData,
  type InstanceNodeData,
} from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import type { SystemPin } from '../../../../domain/systemGraph';
import { fakeMeasure } from './fixtureGraph';
import { foldingGraph, pin } from './foldingGraph';

const GROUP = '/hub::M*_AXI|master|i';
const graph = foldingGraph();
const closed = { open: new Set<string>() };
const opened = { open: new Set([GROUP]) };

const hubOf = (input: ElkNode) => input.children!.find((node) => node.id === '/hub')!;
const portIds = (node: ElkNode) => (node.ports ?? []).map((port) => port.id);
const memberPort = (index: number) => `/hub::M${String(index).padStart(2, '0')}_AXI`;

describe('buildElkInput with folded pin arrays', () => {
  it('is today input without pinFolding', () => {
    const plain = buildElkInput(graph, '/', { measure: fakeMeasure });
    expect(portIds(hubOf(plain))).toHaveLength(29);
    expect(hubOf(plain).height).toBe(HEADER_HEIGHT + 28 * PIN_ROW_HEIGHT + 10);
    expect(buildElkInput(graph, '/', { measure: fakeMeasure, pinFolding: undefined })).toEqual(
      plain
    );
  });

  it('shrinks the block to the folded rows with one group port', () => {
    const input = buildElkInput(graph, '/', { measure: fakeMeasure, pinFolding: closed });
    const hub = hubOf(input);
    expect(hub.height).toBe(HEADER_HEIGHT + 1 * PIN_ROW_HEIGHT + 10);
    expect(portIds(hub).sort()).toEqual(['/hub::aclk', GROUP].sort());
    const group = hub.ports!.find((port) => port.id === GROUP)!;
    expect(group.labels).toBeUndefined();
    expect(group.y).toBe(HEADER_HEIGHT + 6);
  });

  it('points the edges of the members at the group port, other ends unchanged', () => {
    const input = buildElkInput(graph, '/', { measure: fakeMeasure, pinFolding: closed });
    const memberEdges = input.edges!.filter((edge) => edge.id.startsWith('/::n'));
    expect(memberEdges).toHaveLength(28);
    expect(memberEdges.every((edge) => edge.sources[0] === GROUP)).toBe(true);
    expect(memberEdges[3].targets).toEqual(['/t03::S_AXI']);
    expect(input.edges!.filter((edge) => edge.sources[0] === memberPort(0))).toHaveLength(0);
  });

  it('keeps a clock pin on its own port with its badge label', () => {
    const input = buildElkInput(graph, '/', { measure: fakeMeasure, pinFolding: closed });
    const clock = hubOf(input).ports!.find((port) => port.id === '/hub::aclk')!;
    expect(clock.labels).toHaveLength(1);
    expect(input.edges!.some((edge) => edge.id.startsWith('/::clk#'))).toBe(true);
  });

  it('gives an open group its member ports and a header row without a port', () => {
    const input = buildElkInput(graph, '/', { measure: fakeMeasure, pinFolding: opened });
    const hub = hubOf(input);
    expect(portIds(hub)).toHaveLength(29);
    expect(portIds(hub)).not.toContain(GROUP);
    expect(hub.height).toBe(HEADER_HEIGHT + 29 * PIN_ROW_HEIGHT + 10);
    const first = hub.ports!.find((port) => port.id === memberPort(0))!;
    expect(first.y).toBe(HEADER_HEIGHT + 1 * PIN_ROW_HEIGHT + 6);
    expect(input.edges!.filter((edge) => edge.sources[0] === memberPort(5)).length).toBeGreaterThan(
      0
    );
  });

  it('drops an edge whose two ends fold into one port', () => {
    const loop = foldingGraph(4);
    loop.nets = [
      {
        ...loop.nets[0],
        endpoints: [
          { instance: '/hub', pin: 'M00_AXI' },
          { instance: '/hub', pin: 'M01_AXI' },
        ],
      },
    ];
    const folded = buildElkInput(loop, '/', { measure: fakeMeasure, pinFolding: closed });
    expect(folded.edges).toHaveLength(0);
    const plain = buildElkInput(loop, '/', { measure: fakeMeasure });
    expect(plain.edges).toHaveLength(1);
  });
});

describe('toFlowElements with folded pin arrays', () => {
  const rowsOf = async (pinFolding: typeof closed) => {
    const input = buildElkInput(graph, '/', { measure: fakeMeasure, pinFolding });
    const result = await runElkLayout(input);
    const flow = toFlowElements(result, graph, '/', fakeMeasure, pinFolding);
    const hub = flow.nodes.find((node) => node.id === '/hub')!;
    return { flow, data: hub.data as InstanceNodeData, input, hubHeight: hub.height };
  };

  it('draws one group row whose name is the port, and wires to its handle', async () => {
    const { flow, data, hubHeight } = await rowsOf(closed);
    expect(data.east.map((row) => row.name)).toEqual([GROUP.slice('/hub::'.length)]);
    const row = data.east[0];
    expect(row.label).toContain('M00..M27_AXI [28]');
    expect(row.group).toMatchObject({ open: false });
    expect(row.group!.members).toHaveLength(28);
    expect(row.category).toBe('aximm');
    expect(row.netNames).toHaveLength(28);
    expect(row.badge).toBeUndefined();
    expect(data.west.map((r) => r.name)).toEqual(['aclk']);
    expect(data.west[0].badge).toBeDefined();
    expect(hubHeight).toBe(HEADER_HEIGHT + PIN_ROW_HEIGHT + 10);
    const handles = flow.edges
      .filter((edge) => edge.source === '/hub' && edge.data.netId.startsWith('/::n'))
      .map((edge) => edge.sourceHandle);
    expect(handles).toHaveLength(28);
    expect(new Set(handles)).toEqual(new Set([row.name]));
  }, 20000);

  it('draws the header and the member rows of an open group', async () => {
    const { data } = await rowsOf(opened);
    expect(data.east).toHaveLength(29);
    expect(data.east[0].group).toMatchObject({ open: true });
    expect(data.east[1].name).toBe('M00_AXI');
    expect(data.east[1].group).toBeUndefined();
  }, 20000);
});

describe('folded row category', () => {
  it('comes from the connected members, so an unused member keeps the marker', async () => {
    const design = foldingGraph(16);
    design.nets = design.nets.filter((net) => net.id !== '/::n15');
    const input = buildElkInput(design, '/', { measure: fakeMeasure, pinFolding: closed });
    const flow = toFlowElements(await runElkLayout(input), design, '/', fakeMeasure, closed);
    const hub = flow.nodes.find((node) => node.id === '/hub')!.data as InstanceNodeData;
    expect(hub.east[0].group!.members[15].unconnected).toBe(true);
    expect(hub.east[0].category).toBe('aximm');
    expect(hub.east[0].unconnected).toBe(false);
  }, 20000);
});

describe('folding on the inner level of an expanded block', () => {
  const idx = Array.from({ length: 6 }, (_, i) => String(i).padStart(2, '0'));
  const nested = (() => {
    const base = foldingGraph(0);
    const inst = (path: string, parent: string, kind: 'ip' | 'hier', pins: SystemPin[]) => ({
      path,
      name: path.split('/').pop()!,
      parent,
      kind,
      parameters: {},
      pins,
      line: 1,
    });
    const hubPins = idx.map((i) => pin(`M${i}_AXI`, 'master', true));
    const wire = (level: string, name: string, ends: [string | null, string][]) => ({
      id: `${level}::${name}`,
      name,
      level,
      isInterface: true,
      category: 'aximm' as const,
      categorySource: 'declared' as const,
      endpoints: ends.map(([instance, pinName]) => ({ instance, pin: pinName })),
      line: 1,
    });
    const targets = idx.map((i) => inst(`/h/t${i}`, '/h', 'ip', [pin('S_AXI', 'slave', true)]));
    const outer = [inst('/h', '/', 'hier', [pin('ext', 'master', true)])];
    return {
      ...base,
      levels: {
        '/': { path: '/', name: 'g', boundaryPins: [], instances: ['/h', '/x'] },
        '/h': {
          path: '/h',
          name: 'h',
          boundaryPins: [pin('ext', 'master', true)],
          instances: ['/h/hub', ...targets.map((t) => t.path)],
        },
      },
      instances: Object.fromEntries(
        [
          ...outer,
          inst('/x', '/', 'ip', [pin('S_AXI', 'slave', true)]),
          inst('/h/hub', '/h', 'ip', hubPins),
          ...targets,
        ].map((i) => [i.path, i])
      ),
      nets: [
        ...idx.slice(0, 5).map((i) =>
          wire('/h', `n${i}`, [
            ['/h/hub', `M${i}_AXI`],
            [`/h/t${i}`, 'S_AXI'],
          ])
        ),
        wire('/h', 'nx', [
          ['/h/hub', 'M05_AXI'],
          [null, 'ext'],
        ]),
        wire('/', 'top', [
          ['/h', 'ext'],
          ['/x', 'S_AXI'],
        ]),
      ],
    };
  })();
  const GROUP_ID = 'M*_AXI|master|i';

  it('folds the inner block, ends the frame-pin edge on the group port, keeps frame pins', async () => {
    const options = { measure: fakeMeasure, expanded: new Set(['/h']), pinFolding: closed };
    const input = buildElkInput(nested, '/', options);
    const edges = input.edges!;
    expect(edges.find((edge) => edge.id === '/h::nx#1')).toMatchObject({
      sources: [`/h/hub::${GROUP_ID}`],
      targets: ['/h::ext'],
    });
    expect(edges.filter((edge) => edge.sources[0] === `/h/hub::${GROUP_ID}`)).toHaveLength(6);

    const laidOut = await runElkLayout(input);
    const flow = toFlowElements(laidOut, nested, '/', fakeMeasure, closed);
    const hub = flow.nodes.find((node) => node.id === '/h/hub')!.data as InstanceNodeData;
    expect(hub.east.map((row) => row.name)).toEqual([GROUP_ID]);
    const frame = flow.nodes.find((node) => node.id === '/h')!;
    expect(frame.type).toBe('frame');
    expect((frame.data as FrameNodeData).east.map((row) => row.name)).toEqual(['ext']);

    const ports = new Set<string>();
    const collect = (node: ElkNode) => {
      (node.ports ?? []).forEach((port) => ports.add(port.id));
      (node.children ?? []).forEach(collect);
    };
    collect(laidOut);
    const handles = new Set<string>();
    for (const node of flow.nodes) {
      const rows = node.type === 'boundary' ? [] : [...node.data.west, ...node.data.east];
      rows.forEach((row) => handles.add(`${node.id}::${row.name}`));
    }
    for (const id of handles) {
      expect(ports.has(id)).toBe(true);
    }
    for (const edge of flow.edges) {
      expect(handles.has(`${edge.source}::${edge.sourceHandle}`)).toBe(true);
      expect(handles.has(`${edge.target}::${edge.targetHandle}`)).toBe(true);
    }
  }, 20000);
});
