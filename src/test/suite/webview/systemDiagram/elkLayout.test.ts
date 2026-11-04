import type { ElkNode } from 'elkjs/lib/elk-api';
import {
  buildElkInput,
  toFlowElements,
  type DiagramFlowNode,
} from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { boundaryId } from '../../../../webview/systemDiagram/model';
import { loadFixtureGraph, loadQsysFixtureGraph } from './fixtureGraph';

const graph = loadFixtureGraph();

function child(input: ElkNode, id: string): ElkNode {
  const found = input.children?.find((candidate) => candidate.id === id);
  expect(found).toBeDefined();
  return found!;
}

/** Asserts that at least one badge exists and no badge box intersects any node box. */
function expectBadgesClearOfNodes(nodes: DiagramFlowNode[]): void {
  const rects = nodes.map((node) => ({
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    w: node.width,
    h: node.height,
  }));
  let badges = 0;
  for (const node of nodes) {
    const rows = node.type === 'instance' ? [...node.data.west, ...node.data.east] : [node.data];
    for (const badge of rows.flatMap((row) => (row.badge ? [row.badge] : []))) {
      badges += 1;
      const box = {
        x: node.position.x + badge.x,
        y: node.position.y + badge.y,
        w: badge.width,
        h: badge.height,
      };
      for (const other of rects) {
        const overlaps =
          box.x < other.x + other.w &&
          other.x < box.x + box.w &&
          box.y < other.y + other.h &&
          other.y < box.y + box.h;
        expect({ badge: badge.netName, node: node.id, other: other.id, overlaps }).toEqual({
          badge: badge.netName,
          node: node.id,
          other: other.id,
          overlaps: false,
        });
      }
    }
  }
  expect(badges).toBeGreaterThan(0);
}

describe('buildElkInput', () => {
  const input = buildElkInput(graph, '/', { showClockReset: true });

  it('creates one flat node per instance and per boundary pin', () => {
    const level = graph.levels['/'];
    expect(input.children).toHaveLength(level.instances.length + level.boundaryPins.length);
    expect(input.children?.every((node) => node.children === undefined)).toBe(true);
    expect(input.layoutOptions).toMatchObject({
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
    });
  });

  it('sizes instances from their pin rows and places ports on fixed sides', () => {
    const dma = graph.instances['/axi_dma_0'];
    const node = child(input, '/axi_dma_0');
    const sides = { west: 0, east: 0 };
    for (const port of node.ports ?? []) {
      expect(port.width).toBe(8);
      expect(port.height).toBe(8);
      if (port.x === -4) {
        sides.west += 1;
      } else {
        expect(port.x).toBe(240 - 4);
        sides.east += 1;
      }
    }
    expect(node.width).toBe(240);
    expect(node.height).toBe(42 + Math.max(sides.west, sides.east) * 18 + 10);
    expect(sides.west + sides.east).toBe(dma.pins.length);
    expect(node.layoutOptions?.['org.eclipse.elk.portConstraints']).toBe('FIXED_POS');
    const master = node.ports?.find((port) => port.id === '/axi_dma_0::M_AXIS_MM2S');
    expect(master?.x).toBe(236);
    const westPorts = (node.ports ?? []).filter((port) => port.x === -4);
    expect(westPorts.map((port) => port.y)).toEqual(westPorts.map((_, i) => 42 + i * 18 + 5));
  });

  it('pins boundary sources to the first layer and sinks to the last', () => {
    const source = child(input, boundaryId('/', 'ext_trigger'));
    const sink = child(input, boundaryId('/', 'trigger_pulse'));
    expect(source.layoutOptions?.['elk.layered.layering.layerConstraint']).toBe('FIRST');
    expect(sink.layoutOptions?.['elk.layered.layering.layerConstraint']).toBe('LAST');
    expect([source.width, source.height]).toEqual([150, 26]);
    expect(source.ports).toHaveLength(1);
    expect(source.ports?.[0].x).toBe(146);
    expect(sink.ports?.[0].x).toBe(-4);
  });

  it('draws one edge per net sink from the driver port', () => {
    const net = graph.nets.find((candidate) => candidate.id === '/::axi_dma_0_M_AXIS_MM2S');
    const edges = (input.edges ?? []).filter((edge) => edge.id.startsWith(`${net!.id}#`));
    expect(edges).toHaveLength(net!.endpoints.length - 1);
    for (const edge of edges) {
      expect(edge.sources).toEqual(['/axi_dma_0::M_AXIS_MM2S']);
    }
  });

  it('omits clock and reset nets unless requested', () => {
    const hidden = buildElkInput(graph, '/', { showClockReset: false });
    const clockEdges = (id: string, node: ElkNode) =>
      (node.edges ?? []).filter((edge) => edge.id.startsWith(`${id}#`));
    expect(clockEdges('/::processing_system7_0_FCLK_CLK0', input).length).toBeGreaterThan(0);
    expect(clockEdges('/::processing_system7_0_FCLK_CLK0', hidden)).toHaveLength(0);
    expect(hidden.edges!.length).toBeLessThan(input.edges!.length);
  });
});

describe('real ELK layout of the fixture root level', () => {
  it('positions every node and routes every edge', async () => {
    const input = buildElkInput(graph, '/', { showClockReset: false });
    const result = await runElkLayout(input);
    const { nodes, edges } = toFlowElements(result, graph, '/');

    expect(nodes).toHaveLength(input.children!.length);
    for (const node of nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
      expect(node.draggable).toBe(false);
    }
    expect(edges).toHaveLength(input.edges!.length);
    for (const edge of edges) {
      expect(edge.type).toBe('elk');
      expect(edge.data.points.length).toBeGreaterThanOrEqual(2);
    }
    const byType = (type: DiagramFlowNode['type']) => nodes.filter((n) => n.type === type);
    expect(byType('instance')).toHaveLength(graph.levels['/'].instances.length);
    expect(byType('boundary')).toHaveLength(graph.levels['/'].boundaryPins.length);
    const sample = edges.find((edge) => edge.data.netId === '/::axi_dma_0_M_AXIS_MM2S');
    expect(sample?.data).toMatchObject({ category: 'axis', isInterface: true });
  }, 20000);
});

describe('real ELK layout of the qsys fixture root level', () => {
  const qsys = loadQsysFixtureGraph();

  it('routes every visible net and keeps badges clear of other nodes', async () => {
    const input = buildElkInput(qsys, '/', { showClockReset: false });
    const result = await runElkLayout(input);
    const { nodes, edges } = toFlowElements(result, qsys, '/');
    expect(edges).toHaveLength(input.edges!.length);
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      expect(edge.data.points.length).toBeGreaterThanOrEqual(2);
    }
    expect(
      edges.find((edge) => edge.data.netId === '/::nios2_gen2_0.data_master')?.data
    ).toMatchObject({
      category: 'avalonmm',
      isInterface: true,
    });
    expectBadgesClearOfNodes(nodes);
  }, 20000);
});

describe('pin hover data of pins on several nets', () => {
  it('carries every net name next to the first', () => {
    const qsys = loadQsysFixtureGraph();
    const { nodes } = toFlowElements(buildElkInput(qsys, '/', { showClockReset: true }), qsys, '/');
    const memory = nodes.find((node) => node.id === '/onchip_memory2_0');
    const row =
      memory?.type === 'instance' ? memory.data.west.find((r) => r.name === 's1') : undefined;
    expect(row?.netNames).toEqual(['nios2_gen2_0.data_master', 'nios2_gen2_0.instruction_master']);
    expect(row?.netName).toBe('nios2_gen2_0.data_master');
    const boundary = nodes.find((node) => node.id === boundaryId('/', 'clk'));
    expect(boundary?.type === 'boundary' ? boundary.data.netNames : []).toEqual(['clk']);
  });

  it('carries definedBy to the pin row', () => {
    const defined = JSON.parse(JSON.stringify(graph)) as typeof graph;
    defined.instances['/axi_dma_0'].pins[0].definedBy = 'ip.yml';
    const { nodes } = toFlowElements(
      buildElkInput(defined, '/', { showClockReset: true }),
      defined,
      '/'
    );
    const node = nodes.find((n) => n.id === '/axi_dma_0');
    expect(
      node?.type === 'instance'
        ? node.data.west.concat(node.data.east).some((r) => r.definedBy === 'ip.yml')
        : false
    ).toBe(true);
  });
});

describe('hidden clock and reset net badges', () => {
  const labelledPorts = (input: ElkNode) =>
    (input.children ?? []).flatMap((node) =>
      (node.ports ?? []).filter((port) => (port.labels?.length ?? 0) > 0)
    );

  it('reserves port labels only for pins of hidden nets', () => {
    const hidden = buildElkInput(graph, '/', { showClockReset: false });
    const shown = buildElkInput(graph, '/', { showClockReset: true });
    expect(labelledPorts(shown)).toHaveLength(0);

    const fclk = graph.nets.find((net) => net.id === '/::processing_system7_0_FCLK_CLK0')!;
    const expected = fclk.endpoints.map((ref) =>
      ref.instance === null ? `${'/'}::${ref.pin}::${ref.pin}` : `${ref.instance}::${ref.pin}`
    );
    const labelled = labelledPorts(hidden);
    for (const id of expected) {
      const port = labelled.find((candidate) => candidate.id === id);
      expect(port?.labels?.[0].text).toBe(
        fclk.name.length > 24 ? `${fclk.name.slice(0, 24)}…` : fclk.name
      );
    }
    const dmaMaster = (hidden.children ?? [])
      .find((node) => node.id === '/axi_dma_0')
      ?.ports?.find((port) => port.id === '/axi_dma_0::M_AXIS_MM2S');
    expect(dmaMaster?.labels).toBeUndefined();
    expect(
      hidden.children?.every(
        (node) => node.layoutOptions?.['org.eclipse.elk.portLabels.placement'] === 'OUTSIDE'
      )
    ).toBe(true);
  });

  it('truncates long net names to 24 characters with an ellipsis', () => {
    const long = JSON.parse(JSON.stringify(graph)) as typeof graph;
    const net = long.nets.find(
      (candidate) => candidate.id === '/::processing_system7_0_FCLK_CLK0'
    )!;
    net.name = 'a_very_long_clock_net_name_exceeding_the_limit';
    const input = buildElkInput(long, '/', { showClockReset: false });
    const text = labelledPorts(input)[0].labels![0].text!;
    expect(text).toBe(`${net.name.slice(0, 24)}…`);
  });

  for (const level of ['/', '/dsp_pipeline']) {
    it(`keeps every badge clear of other nodes on ${level} (real ELK)`, async () => {
      const result = await runElkLayout(buildElkInput(graph, level, { showClockReset: false }));
      const { nodes } = toFlowElements(result, graph, level);
      expectBadgesClearOfNodes(nodes);
    }, 20000);
  }
});
