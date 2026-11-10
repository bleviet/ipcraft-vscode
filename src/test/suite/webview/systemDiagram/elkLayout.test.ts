import type { ElkNode } from 'elkjs/lib/elk-api';
import { readBdTcl } from '../../../../parser/system/BdTclReader';
import { readQsysTcl } from '../../../../parser/system/QsysTclReader';
import {
  buildElkInput,
  toFlowElements,
  type DiagramFlowNode,
} from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { isolationSubset } from '../../../../webview/systemDiagram/isolation';
import { levelEdges } from '../../../../webview/systemDiagram/layout/levelEdges';
import { boundaryId, isClockOrReset, pinRole } from '../../../../webview/systemDiagram/model';
import type { NetCategory, SystemGraph } from '../../../../domain/systemGraph';
import {
  loadFixtureGraph,
  loadQsysFixtureGraph,
  loadQsysTclFixtureGraph,
  loadReviewFixtureGraph,
  loadVersalClockGraph,
  loadClockFixtureGraph,
  fakeMeasure,
} from './fixtureGraph';

const graph = loadFixtureGraph();

function child(input: ElkNode, id: string): ElkNode {
  const found = input.children?.find((candidate) => candidate.id === id);
  expect(found).toBeDefined();
  return found!;
}

/** The net of an ELK or flow edge, from its id `${net.id}#${endpointIndex}`. */
function netOfEdge(design: SystemGraph, edgeId: string) {
  const netId = edgeId.slice(0, edgeId.lastIndexOf('#'));
  const net = design.nets.find((candidate) => candidate.id === netId);
  expect(net).toBeDefined();
  return net!;
}

/** The ELK edges routed by ELK as wires: every one but the clock and reset edges that only anchor a block. */
function wireCount(design: SystemGraph, input: ElkNode): number {
  return (input.edges ?? []).filter((edge) => !isClockOrReset(netOfEdge(design, edge.id))).length;
}

/** Clock and reset wires drawn for `levels`: one per edge, routed after the layout. */
function clockResetCount(design: SystemGraph, levels: string[]): number {
  return levels.flatMap((level) => levelEdges(design, level).filter(isClockOrReset)).length;
}

/** Asserts the flow edges hold the ELK data wires and one routed wire per clock or reset edge. */
function expectWires(
  design: SystemGraph,
  input: ElkNode,
  edges: { data: { category: NetCategory } }[],
  levels: string[] = ['/']
): void {
  const routed = edges.filter((edge) => isClockOrReset(edge.data));
  expect(edges.length - routed.length).toBe(wireCount(design, input));
  expect(routed).toHaveLength(clockResetCount(design, levels));
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
    const rows = node.type === 'boundary' ? [node.data] : [...node.data.west, ...node.data.east];
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
  const input = buildElkInput(graph, '/', { measure: fakeMeasure });

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
        expect(port.x).toBe((node.width ?? 0) - 4);
        sides.east += 1;
      }
    }
    expect(node.width).toBeGreaterThanOrEqual(180);
    expect(node.width).toBeLessThanOrEqual(420);
    expect(node.height).toBe(42 + Math.max(sides.west, sides.east) * 18 + 10);
    expect(sides.west + sides.east).toBe(dma.pins.length);
    expect(node.layoutOptions?.['org.eclipse.elk.portConstraints']).toBe('FIXED_POS');
    const master = node.ports?.find((port) => port.id === '/axi_dma_0::M_AXIS_MM2S');
    expect(master?.x).toBe((node.width ?? 0) - 4);
    const westPorts = (node.ports ?? []).filter((port) => port.x === -4);
    expect(westPorts.map((port) => port.y)).toEqual(westPorts.map((_, i) => 42 + i * 18 + 6));
  });

  it('sizes boundary pins and puts them in a column of their own', () => {
    const source = child(input, boundaryId('/', 'ext_trigger'));
    const sink = child(input, boundaryId('/', 'trigger_pulse'));
    expect(source.layoutOptions).toMatchObject({
      'elk.layered.layering.layerConstraint': 'FIRST_SEPARATE',
      'elk.alignment': 'LEFT',
    });
    expect(sink.layoutOptions).toMatchObject({
      'elk.layered.layering.layerConstraint': 'LAST_SEPARATE',
      'elk.alignment': 'RIGHT',
    });
    expect(source.height).toBe(26);
    expect(source.width).toBe(Math.max(100, 24 + 'ext_trigger'.length * 7));
    expect(source.ports).toHaveLength(1);
    expect(source.ports?.[0].x).toBe((source.width ?? 0) - 4);
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

  it('places the blocks by their data nets, a clock or reset net only anchoring a block without one', () => {
    const all = levelEdges(graph, '/');
    const dataNodes = new Set(
      all
        .filter((edge) => !isClockOrReset(edge))
        .flatMap((edge) => [edge.sourceNode, edge.targetNode])
    );
    const clockReset = (input.edges ?? []).filter((edge) =>
      isClockOrReset(netOfEdge(graph, edge.id))
    );
    for (const edge of clockReset) {
      const target = edge.targets[0].slice(0, edge.targets[0].lastIndexOf('::'));
      expect({ edge: edge.id, intoDataBlock: dataNodes.has(target) }).toEqual({
        edge: edge.id,
        intoDataBlock: false,
      });
    }
    const intoReset = (edges: readonly { id: string; targetNode: string }[]) =>
      edges.filter((edge) => edge.targetNode === '/rst_ps7_0_100M').map((edge) => edge.id);
    expect(intoReset(all).length).toBeGreaterThan(0);
    expect(
      (input.edges ?? [])
        .filter((edge) => edge.targets[0].startsWith('/rst_ps7_0_100M::'))
        .map((edge) => edge.id)
    ).toEqual(intoReset(all));
    expect(input.edges!.length).toBeLessThan(all.length);
  });
});

describe('real ELK layout of the fixture root level', () => {
  it('positions every node and routes every edge', async () => {
    const input = buildElkInput(graph, '/', { measure: fakeMeasure });
    const result = await runElkLayout(input);
    const { nodes, edges } = toFlowElements(result, graph, '/', fakeMeasure);

    expect(nodes).toHaveLength(input.children!.length);
    for (const node of nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
      expect(node.draggable).toBe(false);
    }
    // ELK routes the data wires; every clock and reset edge is routed afterwards.
    expect(wireCount(graph, input)).toBeLessThan(input.edges!.length);
    expectWires(graph, input, edges);
    expect(edges.some((edge) => isClockOrReset(edge.data))).toBe(true);
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

  it('routes every net and keeps badges clear of other nodes', async () => {
    const input = buildElkInput(qsys, '/', { measure: fakeMeasure });
    const result = await runElkLayout(input);
    const { nodes, edges } = toFlowElements(result, qsys, '/', fakeMeasure);
    expectWires(qsys, input, edges);
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

describe('real ELK layout of the qsys-script fixture root level', () => {
  const qsysTcl = loadQsysTclFixtureGraph();

  it('routes every net and keeps badges clear of other nodes', async () => {
    const input = buildElkInput(qsysTcl, '/', { measure: fakeMeasure });
    const result = await runElkLayout(input);
    const { nodes, edges } = toFlowElements(result, qsysTcl, '/', fakeMeasure);
    expectWires(qsysTcl, input, edges);
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      expect(edge.data.points.length).toBeGreaterThanOrEqual(2);
    }
    expectBadgesClearOfNodes(nodes);
  }, 20000);
});

describe('pin hover data of pins on several nets', () => {
  it('carries every net name next to the first', () => {
    const qsys = loadQsysFixtureGraph();
    const { nodes } = toFlowElements(
      buildElkInput(qsys, '/', { measure: fakeMeasure }),
      qsys,
      '/',
      fakeMeasure
    );
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
      buildElkInput(defined, '/', { measure: fakeMeasure }),
      defined,
      '/',
      fakeMeasure
    );
    const node = nodes.find((n) => n.id === '/axi_dma_0');
    expect(
      node?.type === 'instance'
        ? node.data.west.concat(node.data.east).some((r) => r.definedBy === 'ip.yml')
        : false
    ).toBe(true);
  });
});

describe('content-sized nodes', () => {
  it('varies widths per node and places east ports on the computed width', () => {
    const input = buildElkInput(graph, '/', { measure: fakeMeasure });
    const widths = new Set((input.children ?? []).map((node) => node.width));
    expect(widths.size).toBeGreaterThan(2);
    for (const node of input.children ?? []) {
      for (const port of node.ports ?? []) {
        expect([-4, (node.width ?? 0) - 4]).toContain(port.x);
      }
    }
  });

  const fixtures: [string, typeof graph, string][] = [
    ['Vivado', graph, '/'],
    ['Vivado hierarchy', graph, '/dsp_pipeline'],
    ['qsys', loadQsysFixtureGraph(), '/'],
    ['qsys-tcl', loadQsysTclFixtureGraph(), '/'],
  ];
  for (const [name, fixture, level] of fixtures) {
    it(`keeps node boxes apart on the ${name} fixture`, async () => {
      const result = await runElkLayout(buildElkInput(fixture, level, { measure: fakeMeasure }));
      const { nodes } = toFlowElements(result, fixture, level, fakeMeasure);
      for (const a of nodes) {
        for (const b of nodes) {
          if (a.id < b.id) {
            const overlaps =
              a.position.x < b.position.x + b.width &&
              b.position.x < a.position.x + a.width &&
              a.position.y < b.position.y + b.height &&
              b.position.y < a.position.y + a.height;
            expect({ a: a.id, b: b.id, overlaps }).toEqual({ a: a.id, b: b.id, overlaps: false });
          }
        }
      }
    }, 20000);
  }
});

describe('clock and reset net badges', () => {
  const labelledPorts = (input: ElkNode) =>
    (input.children ?? []).flatMap((node) =>
      (node.ports ?? []).filter((port) => (port.labels?.length ?? 0) > 0)
    );

  it('reserves port labels only for pins of clock and reset nets, whatever the view shows', () => {
    const input = buildElkInput(graph, '/', { measure: fakeMeasure });
    const fclk = graph.nets.find((net) => net.id === '/::processing_system7_0_FCLK_CLK0')!;
    const expected = fclk.endpoints.map((ref) =>
      ref.instance === null ? `${'/'}::${ref.pin}::${ref.pin}` : `${ref.instance}::${ref.pin}`
    );
    const labelled = labelledPorts(input);
    for (const id of expected) {
      const port = labelled.find((candidate) => candidate.id === id);
      expect(port?.labels?.[0].text).toBe('FCLK_CLK0');
    }
    const dmaMaster = (input.children ?? [])
      .find((node) => node.id === '/axi_dma_0')
      ?.ports?.find((port) => port.id === '/axi_dma_0::M_AXIS_MM2S');
    expect(dmaMaster?.labels).toBeUndefined();
    expect(
      input.children?.every(
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
    const input = buildElkInput(long, '/', { measure: fakeMeasure });
    const text = labelledPorts(input)[0].labels![0].text!;
    expect(text).toBe(`${net.name.slice(0, 24)}…`);
  });

  for (const level of ['/', '/dsp_pipeline']) {
    it(`keeps every badge clear of other nodes on ${level} (real ELK)`, async () => {
      const result = await runElkLayout(buildElkInput(graph, level, { measure: fakeMeasure }));
      const { nodes } = toFlowElements(result, graph, level, fakeMeasure);
      expectBadgesClearOfNodes(nodes);
    }, 20000);
  }
});

describe('unconnected pin rows', () => {
  it('flags pins without nets, counting hidden clock and reset nets as connected', () => {
    const input = buildElkInput(graph, '/', { measure: fakeMeasure });
    const { nodes } = toFlowElements(input, graph, '/', fakeMeasure);
    const dma = nodes.find((node) => node.id === '/axi_dma_0');
    const rows = dma?.type === 'instance' ? [...dma.data.west, ...dma.data.east] : [];
    expect(rows.find((row) => row.name === 's_axi_lite_aclk')?.unconnected).toBe(false);

    const bare = { ...graph, nets: [] };
    const bareInput = buildElkInput(bare, '/', { measure: fakeMeasure });
    const bareDma = toFlowElements(bareInput, bare, '/', fakeMeasure).nodes.find(
      (node) => node.id === '/axi_dma_0'
    );
    const bareRows =
      bareDma?.type === 'instance' ? [...bareDma.data.west, ...bareDma.data.east] : [];
    expect(bareRows.length).toBeGreaterThan(0);
    expect(bareRows.every((row) => row.unconnected)).toBe(true);
  });
});

describe('buildElkInput isolate', () => {
  const full = buildElkInput(graph, '/', { measure: fakeMeasure });

  it('emits only the subset and keeps the shared edge ids', () => {
    const subset = isolationSubset(graph, '/', ['/axi_dma_0']);
    const input = buildElkInput(graph, '/', {
      measure: fakeMeasure,
      isolate: subset,
    });
    expect(input.children?.map((node) => node.id).sort()).toEqual([...subset.nodeIds].sort());
    expect(input.edges?.map((edge) => edge.id).sort()).toEqual([...subset.edgeIds].sort());
    const fullIds = new Set(full.edges?.map((edge) => edge.id));
    expect(input.edges?.every((edge) => fullIds.has(edge.id))).toBe(true);
    expect(fullIds.has('/::axi_dma_0_M_AXI_MM2S#1')).toBe(true);
  });

  it('keeps every pin of an isolated block and the graph-based unconnected flags', () => {
    const subset = isolationSubset(graph, '/', ['/axi_dma_0']);
    const input = buildElkInput(graph, '/', {
      measure: fakeMeasure,
      isolate: subset,
    });
    expect(child(input, '/axi_dma_0').ports).toEqual(child(full, '/axi_dma_0').ports);
    const nodes = toFlowElements(input, graph, '/', fakeMeasure).nodes;
    const dma = nodes.find((node) => node.id === '/axi_dma_0');
    const rows = dma?.type === 'instance' ? [...dma.data.west, ...dma.data.east] : [];
    expect(rows.find((row) => row.name === 's_axi_lite_aclk')?.unconnected).toBe(false);
  });
});

describe('buildElkInput with expanded blocks', () => {
  const DSP = '/dsp_pipeline';
  const BANK = '/dsp_pipeline/coeff_bank';
  const options = { measure: fakeMeasure };
  const expandedInput = buildElkInput(graph, '/', { ...options, expanded: new Set([DSP]) });

  it('equals the collapsed input when nothing is expanded, or the expanded block is not shown', () => {
    const collapsed = buildElkInput(graph, '/', options);
    expect(buildElkInput(graph, '/', { ...options, expanded: new Set() })).toEqual(collapsed);
    expect(buildElkInput(graph, '/', { ...options, expanded: new Set([BANK]) })).toEqual(collapsed);
    expect(buildElkInput(graph, '/', { ...options, expanded: new Set(['/axi_dma_0']) })).toEqual(
      collapsed
    );
    expect(collapsed.layoutOptions).not.toHaveProperty('elk.hierarchyHandling');
    expect(collapsed.layoutOptions).not.toHaveProperty('elk.json.edgeCoords');
  });

  it('turns the block into a compound node of its inner level and sets the root options', () => {
    expect(expandedInput.layoutOptions).toMatchObject({
      'elk.algorithm': 'layered',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.json.edgeCoords': 'ROOT',
    });
    const frame = child(expandedInput, DSP);
    expect(frame.width).toBeUndefined();
    expect(frame.height).toBeUndefined();
    expect(frame.children?.map((node) => node.id)).toEqual(graph.levels[DSP].instances);
    expect(frame.layoutOptions).toMatchObject({
      'elk.algorithm': 'layered',
      'elk.portConstraints': 'FIXED_SIDE',
      'elk.spacing.portPort': '18',
    });
    expect(frame.layoutOptions?.['elk.padding']).toMatch(
      /^\[top=\d+,left=\d+,bottom=\d+,right=\d+\]$/
    );
    // The collapsed sibling is a plain node, and the root keeps its other children.
    expect(child(expandedInput, '/axi_dma_0').children).toBeUndefined();
    expect(expandedInput.children).toHaveLength(
      buildElkInput(graph, '/', options).children?.length ?? NaN
    );
  });

  it('puts the pins on the border as side ports centred on it', () => {
    const frame = child(expandedInput, DSP);
    const sides = new Map(
      (frame.ports ?? []).map((port) => [port.id, port.layoutOptions?.['elk.port.side']])
    );
    expect([...sides]).toEqual([
      [`${DSP}::S_AXIS`, 'WEST'],
      [`${DSP}::aclk`, 'WEST'],
      [`${DSP}::aresetn`, 'WEST'],
      [`${DSP}::M_AXIS`, 'EAST'],
    ]);
    for (const port of frame.ports ?? []) {
      expect(port).toMatchObject({ width: 8, height: 8 });
      expect(port.layoutOptions?.['elk.port.borderOffset']).toBe('-4');
    }
  });

  it('does not emit the boundary pins of the inner level as nodes', () => {
    const ids = (child(expandedInput, DSP).children ?? []).map((node) => node.id);
    expect(ids.some((id) => id.includes('::'))).toBe(false);
  });

  it('ends the inner edges on the ports of the block', () => {
    const edges = new Map((expandedInput.edges ?? []).map((edge) => [edge.id, edge]));
    expect(edges.get(`${DSP}::Conn1#1`)).toMatchObject({
      sources: [`${DSP}::S_AXIS`],
      targets: [`${DSP}/axis_data_fifo_0::S_AXIS`],
    });
    expect(edges.get(`${DSP}::Conn2#0`)).toMatchObject({
      sources: [`${DSP}/fir_compiler_0::M_AXIS_DATA`],
      targets: [`${DSP}::M_AXIS`],
    });
    // The outer wires end on the same ports, from outside.
    expect(edges.get('/::axi_dma_0_M_AXIS_MM2S#1')?.targets).toEqual([`${DSP}::S_AXIS`]);
    const ports = new Set(
      [
        expandedInput,
        ...(expandedInput.children ?? []),
        ...(child(expandedInput, DSP).children ?? []),
      ]
        .flatMap((node) => node.ports ?? [])
        .map((port) => port.id)
    );
    for (const edge of expandedInput.edges ?? []) {
      expect(ports.has(edge.sources[0])).toBe(true);
      expect(ports.has(edge.targets[0])).toBe(true);
    }
  });

  it('nests a block expanded inside an expanded block', () => {
    const nested = buildElkInput(graph, '/', { ...options, expanded: new Set([DSP, BANK]) });
    const bank = child(child(nested, DSP), BANK);
    expect(bank.children?.map((node) => node.id)).toEqual(graph.levels[BANK].instances);
    const edge = (nested.edges ?? []).find((candidate) =>
      candidate.id.startsWith(`${BANK}::config_fifo_M_AXIS#`)
    );
    expect(edge?.targets).toEqual([`${BANK}::M_AXIS_CONFIG`]);
  });

  it('keeps the inner content of an isolated expanded block and drops the hidden ones', () => {
    const withBlock = isolationSubset(graph, '/', [DSP]);
    const kept = buildElkInput(graph, '/', {
      ...options,
      expanded: new Set([DSP]),
      isolate: withBlock,
    });
    expect(child(kept, DSP).children).toHaveLength(graph.levels[DSP].instances.length);
    expect(kept.edges?.some((edge) => edge.id.startsWith(`${DSP}::`))).toBe(true);

    const without = isolationSubset(graph, '/', ['/axi_dma_0']);
    const dropped = buildElkInput(graph, '/', {
      ...options,
      expanded: new Set([DSP]),
      isolate: { ...without, nodeIds: new Set([...without.nodeIds].filter((id) => id !== DSP)) },
    });
    expect(dropped.children?.some((node) => node.id === DSP)).toBe(false);
    expect(dropped.edges?.every((edge) => !edge.id.startsWith(`${DSP}::`))).toBe(true);
    expect(dropped.layoutOptions).not.toHaveProperty('elk.hierarchyHandling');
  });

  it('never makes an expanded block smaller than the collapsed one', () => {
    const empty = JSON.parse(JSON.stringify(graph)) as typeof graph;
    empty.levels[BANK].instances = [];
    empty.nets = empty.nets.filter((net) => net.level !== BANK);
    const input = buildElkInput(empty, '/', {
      ...options,
      expanded: new Set([DSP, BANK]),
    });
    const bank = child(child(input, DSP), BANK);
    expect(bank.children).toEqual([]);
    expect(bank.layoutOptions?.['elk.nodeSize.minimum']).toMatch(/^\(\d+,\d+\)$/);
  });
});

describe('real ELK layout of expanded blocks', () => {
  const DSP = '/dsp_pipeline';
  const BANK = '/dsp_pipeline/coeff_bank';

  async function layoutOf(expanded: string[], design = graph) {
    const input = buildElkInput(design, '/', {
      measure: fakeMeasure,
      expanded: new Set(expanded),
    });
    const result = await runElkLayout(input);
    return { input, result, ...toFlowElements(result, design, '/', fakeMeasure) };
  }

  const nodeOf = (nodes: DiagramFlowNode[], id: string) => nodes.find((node) => node.id === id)!;

  /** Every wire ends on the left or right border of its node, within the node's height. */
  function expectEndsOnBorders(
    nodes: DiagramFlowNode[],
    edges: {
      id: string;
      source: string;
      target: string;
      data: { points: { x: number; y: number }[] };
    }[]
  ) {
    for (const edge of edges) {
      const points = edge.data.points;
      for (const [point, id] of [
        [points[0], edge.source],
        [points[points.length - 1], edge.target],
      ] as const) {
        const node = nodeOf(nodes, id);
        const onBorder =
          Math.abs(point.x - node.position.x) < 0.5 ||
          Math.abs(point.x - (node.position.x + node.width)) < 0.5;
        const inRange =
          point.y >= node.position.y - 0.5 && point.y <= node.position.y + node.height + 0.5;
        expect({ edge: edge.id, node: id, onBorder, inRange }).toEqual({
          edge: edge.id,
          node: id,
          onBorder: true,
          inRange: true,
        });
      }
    }
  }

  it('draws the block as a frame below its inner blocks, which lie inside it', async () => {
    const { nodes, edges, input } = await layoutOf([DSP]);
    const frame = nodeOf(nodes, DSP);
    expect(frame.type).toBe('frame');
    expect(frame.zIndex).toBe(-1);
    const innerIds = graph.levels[DSP].instances;
    expect(nodes.filter((node) => node.type === 'frame')).toHaveLength(1);
    expect(nodes.filter((node) => node.type === 'boundary')).toHaveLength(
      graph.levels['/'].boundaryPins.length
    );
    for (const id of innerIds) {
      const inner = nodeOf(nodes, id);
      expect(nodes.indexOf(frame)).toBeLessThan(nodes.indexOf(inner));
      expect(inner.type).toBe('instance');
      expect(inner.zIndex).toBeUndefined();
      expect(inner.position.x).toBeGreaterThanOrEqual(frame.position.x);
      expect(inner.position.x + inner.width).toBeLessThanOrEqual(frame.position.x + frame.width);
      expect(inner.position.y).toBeGreaterThanOrEqual(frame.position.y + 42);
      expect(inner.position.y + inner.height).toBeLessThanOrEqual(frame.position.y + frame.height);
    }
    expectWires(graph, input, edges, ['/', DSP]);
    // Clock and reset wires end at their badges, outside the borders.
    expectEndsOnBorders(
      nodes,
      edges.filter((edge) => !isClockOrReset(edge.data))
    );
  }, 20000);

  it('centres the ports on the border and the pin rows on the ports', async () => {
    const { result, nodes } = await layoutOf([DSP]);
    const laidOut = child(result, DSP);
    const frame = nodeOf(nodes, DSP);
    if (frame.type !== 'frame') {
      throw new Error('expected a frame');
    }
    for (const port of laidOut.ports ?? []) {
      expect([-4, (laidOut.width ?? 0) - 4]).toContain(port.x);
    }
    const rows = [...frame.data.west, ...frame.data.east];
    expect(rows.map((row) => row.name).sort()).toEqual(
      graph.instances[DSP].pins.map((pin) => pin.name).sort()
    );
    for (const row of rows) {
      const port = laidOut.ports?.find((candidate) => candidate.id === `${DSP}::${row.name}`);
      expect(row.y).toBe((port?.y ?? NaN) + 4);
      expect(row.y).toBeGreaterThanOrEqual(42);
      expect(row.y).toBeLessThanOrEqual(frame.height);
    }
    expect(frame.data.west.map((row) => row.side)).toEqual(['west', 'west', 'west']);
    expect(frame.data.east.map((row) => row.name)).toEqual(['M_AXIS']);
    expect(frame.data.cellCount).toBe(graph.levels[DSP].instances.length);
  }, 20000);

  it('gives a frame pin the nets of both sides, outer first, and the badge of the outer clock only', async () => {
    const { nodes } = await layoutOf([DSP]);
    const frame = nodeOf(nodes, DSP);
    if (frame.type !== 'frame') {
      throw new Error('expected a frame');
    }
    const row = (name: string) =>
      [...frame.data.west, ...frame.data.east].find((r) => r.name === name)!;
    expect(row('S_AXIS').netNames).toEqual(['axi_dma_0_M_AXIS_MM2S', 'Conn1']);
    expect(row('S_AXIS').netName).toBe('axi_dma_0_M_AXIS_MM2S');
    expect(row('S_AXIS').badge).toBeUndefined();
    expect(row('aclk').netNames).toEqual(['processing_system7_0_FCLK_CLK0', 'aclk_1']);
    expect(row('aclk').badge?.netId).toBe('/::processing_system7_0_FCLK_CLK0');
    expect(row('aclk').badge?.nets.map((net) => net.id)).toEqual([
      '/::processing_system7_0_FCLK_CLK0',
    ]);
    expect(row('aclk').unconnected).toBe(false);
    // The inner blocks keep their own clock badge.
    const fifo = nodeOf(nodes, `${DSP}/axis_data_fifo_0`);
    const clockRow =
      fifo.type === 'instance' ? fifo.data.west.find((r) => r.name === 's_axis_aclk') : undefined;
    expect(clockRow?.badge?.netId).toBe('/dsp_pipeline::aclk_1');
  }, 20000);

  it('flags a frame pin that no net touches on either side', async () => {
    const review = loadReviewFixtureGraph();
    const { nodes } = await layoutOf([BANK, DSP], review);
    const bank = nodeOf(nodes, BANK);
    if (bank.type !== 'frame') {
      throw new Error('expected a frame');
    }
    const rows = [...bank.data.west, ...bank.data.east];
    expect(rows.find((row) => row.name === 'cfg_open')?.unconnected).toBe(true);
    expect(rows.find((row) => row.name === 'aclk')?.unconnected).toBe(false);
  }, 20000);

  it('lays out nested expansion with absolute positions and wires on the borders', async () => {
    const { nodes, edges, input } = await layoutOf([DSP, BANK]);
    const outer = nodeOf(nodes, DSP);
    const frame = nodeOf(nodes, BANK);
    expect([outer.type, frame.type]).toEqual(['frame', 'frame']);
    expect(nodes.indexOf(outer)).toBeLessThan(nodes.indexOf(frame));
    expect(frame.position.x).toBeGreaterThanOrEqual(outer.position.x);
    expect(frame.position.x + frame.width).toBeLessThanOrEqual(outer.position.x + outer.width);
    for (const id of graph.levels[BANK].instances) {
      const inner = nodeOf(nodes, id);
      expect(nodes.indexOf(frame)).toBeLessThan(nodes.indexOf(inner));
      expect(inner.position.x).toBeGreaterThanOrEqual(frame.position.x);
      expect(inner.position.x + inner.width).toBeLessThanOrEqual(frame.position.x + frame.width);
      expect(inner.position.y).toBeGreaterThanOrEqual(frame.position.y);
      expect(inner.position.y + inner.height).toBeLessThanOrEqual(frame.position.y + frame.height);
    }
    expectWires(graph, input, edges, ['/', DSP, BANK]);
    expectEndsOnBorders(
      nodes,
      edges.filter((edge) => !isClockOrReset(edge.data))
    );
  }, 20000);

  it('sizes an expanded block with an empty level inside as the collapsed block', async () => {
    const empty = JSON.parse(JSON.stringify(graph)) as typeof graph;
    empty.levels[BANK].instances = [];
    empty.nets = empty.nets.filter((net) => net.level !== BANK);
    const { nodes } = await layoutOf([DSP, BANK], empty);
    const bank = nodeOf(nodes, BANK);
    expect(bank.type).toBe('frame');
    expect(bank.width).toBeGreaterThanOrEqual(180);
    expect(bank.height).toBeGreaterThanOrEqual(42);
  }, 20000);
});

describe('known IP output pins in the pin rows', () => {
  // The script records no pin direction; the known outputs of the clocking wizard, the
  // reset block and the constant are drawn on the right, their loads on the left.
  const script = [
    'set clk_wizard_0 [ create_bd_cell -type ip -vlnv xilinx.com:ip:clk_wizard:1.0 clk_wizard_0 ]',
    'set rst_0 [ create_bd_cell -type ip -vlnv xilinx.com:ip:proc_sys_reset:5.0 rst_0 ]',
    'set one_0 [ create_bd_cell -type ip -vlnv xilinx.com:ip:xlconstant:1.1 one_0 ]',
    'set blk_0 [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 blk_0 ]',
    'connect_bd_net -net o1 [get_bd_pins blk_0/clk_a] [get_bd_pins clk_wizard_0/clk_out1_o1]',
    'connect_bd_net -net o2 [get_bd_pins blk_0/clk_b] [get_bd_pins clk_wizard_0/clk_out1_o2]',
    'connect_bd_net -net c2 [get_bd_pins blk_0/clk_c] [get_bd_pins clk_wizard_0/clk_out2]',
    'connect_bd_net -net in1 [get_bd_pins clk_wizard_0/clk_in1] [get_bd_pins blk_0/clk_src]',
    'connect_bd_net -net locked [get_bd_pins clk_wizard_0/locked] [get_bd_pins rst_0/dcm_locked]',
    'connect_bd_net -net rstn [get_bd_pins blk_0/aresetn] [get_bd_pins rst_0/peripheral_aresetn]',
    'connect_bd_net -net one [get_bd_pins clk_wizard_0/clk_out1_ce] [get_bd_pins clk_wizard_0/clk_out1_clr_n] [get_bd_pins one_0/dout]',
  ].join('\n');
  const design = readBdTcl(script, 'known.tcl');
  const input = buildElkInput(design, '/', { measure: fakeMeasure });
  const { nodes } = toFlowElements(input, design, '/', fakeMeasure);
  const sidesOf = (id: string, side: 'west' | 'east') => {
    const node = nodes.find((candidate) => candidate.id === id);
    return node?.type === 'instance' ? node.data[side].map((row) => row.name) : [];
  };

  it('draws the clock and status outputs of the clocking wizard on the east side', () => {
    expect(sidesOf('/clk_wizard_0', 'east')).toEqual(
      expect.arrayContaining(['clk_out1_o1', 'clk_out1_o2', 'clk_out2', 'locked'])
    );
    expect(sidesOf('/clk_wizard_0', 'east')).toHaveLength(4);
  });

  it('keeps the inputs of the clocking wizard on the west side', () => {
    expect(sidesOf('/clk_wizard_0', 'west').sort()).toEqual([
      'clk_in1',
      'clk_out1_ce',
      'clk_out1_clr_n',
    ]);
  });

  it('draws the reset output and the constant on the east side, and their loads on the west', () => {
    expect(sidesOf('/rst_0', 'east')).toEqual(['peripheral_aresetn']);
    expect(sidesOf('/rst_0', 'west')).toEqual(['dcm_locked']);
    expect(sidesOf('/one_0', 'east')).toEqual(['dout']);
    expect(sidesOf('/blk_0', 'east')).toEqual([]);
    expect(sidesOf('/blk_0', 'west').sort()).toEqual([
      'aresetn',
      'clk_a',
      'clk_b',
      'clk_c',
      'clk_src',
    ]);
  });
});

describe('placement of clock and reset input ports', () => {
  it('anchors a clock or reset input port by one edge to a load that has data edges', () => {
    const clocked = loadClockFixtureGraph();
    const input = buildElkInput(clocked, '/', { measure: fakeMeasure });
    for (const pin of ['ext_clk', 'ext_resetn']) {
      const port = boundaryId('/', pin);
      const anchors = (input.edges ?? []).filter(
        (edge) => edge.sources[0].startsWith(`${port}::`) || edge.targets[0].startsWith(`${port}::`)
      );
      expect({ pin, anchors: anchors.length }).toEqual({ pin, anchors: 1 });
    }
  });
});

describe('placement by data flow (real ELK)', () => {
  it('places the AXI slave of the Versal PS before its reset block', async () => {
    const versal = loadVersalClockGraph();
    const result = await runElkLayout(buildElkInput(versal, '/', { measure: fakeMeasure }));
    const x = (id: string) => child(result, id).x ?? 0;
    expect(x('/ctrl_smc')).toBeLessThan(x('/rst_clk_out1'));
  }, 20000);
});

describe('toFlowElements of an empty level', () => {
  const lay = async (design: SystemGraph, level: string) =>
    toFlowElements(
      await runElkLayout(buildElkInput(design, level, { measure: fakeMeasure })),
      design,
      level,
      fakeMeasure
    );

  it('draws nothing for an empty root level', async () => {
    const empty = readBdTcl('create_bd_design "empty"\n', 'empty.tcl');
    expect(await lay(empty, '/')).toEqual({ nodes: [], edges: [] });
  });

  it('draws nothing for an empty hierarchy level', async () => {
    const hier = readBdTcl(
      'create_bd_design "top"\ncreate_bd_cell -type hier empty_h\n',
      'top.tcl'
    );
    expect(hier.levels['/empty_h']).toBeDefined();
    expect((await lay(hier, '/empty_h')).edges).toEqual([]);
  });
});

describe('external port columns (real ELK)', () => {
  const EPS = 0.5;

  /**
   * Asserts the boundary pins of `level` form two columns: inputs share a left edge left of every
   * block, every other port shares a right edge right of every block.
   */
  async function expectPortColumns(
    design: SystemGraph,
    level: string,
    options: Partial<Parameters<typeof buildElkInput>[2]> = {},
    distinctWidths = true
  ) {
    const input = buildElkInput(design, level, { measure: fakeMeasure, ...options });
    const result = await runElkLayout(input);
    const inputIds = new Set(
      design.levels[level].boundaryPins
        .filter((pin) => pinRole(pin, true) === 'source')
        .map((pin) => boundaryId(level, pin.name))
    );
    const outputIds = new Set(
      design.levels[level].boundaryPins
        .map((pin) => boundaryId(level, pin.name))
        .filter((id) => !inputIds.has(id))
    );
    const shown = result.children ?? [];
    const ins = shown.filter((node) => inputIds.has(node.id));
    const outs = shown.filter((node) => outputIds.has(node.id));
    const blocks = shown.filter((node) => !inputIds.has(node.id) && !outputIds.has(node.id));
    expect(blocks.length).toBeGreaterThan(0);
    expect(ins.length + outs.length).toBeGreaterThan(0);
    const minBlockX = Math.min(...blocks.map((node) => node.x ?? 0));
    const maxBlockRight = Math.max(...blocks.map((node) => (node.x ?? 0) + (node.width ?? 0)));
    // Different widths keep the edge alignment checks meaningful.
    for (const column of [ins, outs]) {
      if (distinctWidths && column.length > 1) {
        expect(new Set(column.map((node) => node.width)).size).toBeGreaterThan(1);
      }
    }
    for (const node of ins) {
      expect(Math.abs((node.x ?? 0) - (ins[0].x ?? 0))).toBeLessThan(EPS);
      expect(node.x ?? 0).toBeLessThan(minBlockX);
    }
    for (const node of outs) {
      const right = (node.x ?? 0) + (node.width ?? 0);
      expect(Math.abs(right - ((outs[0].x ?? 0) + (outs[0].width ?? 0)))).toBeLessThan(EPS);
      expect(right).toBeGreaterThan(maxBlockRight);
    }
    return { ins, outs };
  }

  it('aligns the ports of the zynq_dma_system root', async () => {
    const { ins, outs } = await expectPortColumns(graph, '/');
    expect(ins.length).toBeGreaterThan(0);
    expect(outs.length).toBeGreaterThan(0);
  }, 20000);

  it('aligns the ports of a Platform Designer root', async () => {
    for (const design of [loadQsysFixtureGraph(), loadQsysTclFixtureGraph()]) {
      await expectPortColumns(design, '/');
    }
  }, 20000);

  it('aligns the pins of a hierarchy level shown as the level', async () => {
    const { ins, outs } = await expectPortColumns(graph, '/dsp_pipeline', {}, false);
    expect(ins.length).toBeGreaterThan(0);
    expect(outs.length).toBeGreaterThan(0);
  }, 20000);

  it('keeps the columns in an isolated view', async () => {
    const subset = isolationSubset(graph, '/', ['/pulse_gen_0']);
    await expectPortColumns(graph, '/', { isolate: subset });
  }, 20000);

  it('keeps the columns with an expanded hierarchy block', async () => {
    await expectPortColumns(graph, '/', { expanded: new Set(['/dsp_pipeline']) });
  }, 20000);

  it('puts an inout port in the right column', async () => {
    const design = readBdTcl(
      [
        'create_bd_design "top"',
        'set a [ create_bd_port -dir I a ]',
        'set b [ create_bd_port -dir IO b ]',
        'set c [ create_bd_port -dir O long_output_name ]',
        'set u [ create_bd_cell -type module -reference blk u ]',
        'connect_bd_net [get_bd_ports a] [get_bd_pins u/a]',
        'connect_bd_net [get_bd_ports b] [get_bd_pins u/b]',
        'connect_bd_net [get_bd_pins u/c] [get_bd_ports long_output_name]',
      ].join('\n'),
      'top.tcl'
    );
    const pins = design.levels['/'].boundaryPins;
    expect(pins.find((pin) => pin.name === 'b')?.direction).toBe('inout');
    const { ins, outs } = await expectPortColumns(design, '/');
    expect(outs.map((node) => node.id)).toContain(boundaryId('/', 'b'));
    expect(ins.map((node) => node.id)).toEqual([boundaryId('/', 'a')]);
  }, 20000);

  /** A level whose nets join right-column ports: `nets` lists the connect commands. */
  function ioDesign(connects: string[]) {
    return readBdTcl(
      [
        'create_bd_design "top"',
        'set a [ create_bd_port -dir IO a ]',
        'set b [ create_bd_port -dir IO b ]',
        'set c [ create_bd_port -dir IO c ]',
        'set o [ create_bd_port -dir O long_output_name ]',
        'set u [ create_bd_cell -type module -reference blk u ]',
        'connect_bd_net [get_bd_pins u/y] [get_bd_ports long_output_name]',
        ...connects,
      ].join('\n'),
      'top.tcl'
    );
  }

  it('lays out a net that joins two right-column ports', async () => {
    const design = ioDesign(['connect_bd_net [get_bd_ports a] [get_bd_ports b] [get_bd_pins u/x]']);
    const input = buildElkInput(design, '/', { measure: fakeMeasure });
    expect(
      (input.edges ?? []).some(
        (edge) =>
          edge.sources[0].startsWith(boundaryId('/', 'a')) &&
          edge.targets[0].startsWith(boundaryId('/', 'b'))
      )
    ).toBe(true);
    const result = await runElkLayout(input);
    const node = (id: string) => child(result, id);
    const right = (id: string) => (node(id).x ?? 0) + (node(id).width ?? 0);
    const blockRight = right('/u');
    for (const name of ['a', 'b', 'long_output_name']) {
      expect(right(boundaryId('/', name))).toBeGreaterThan(blockRight);
    }
    expect(right(boundaryId('/', 'b'))).toBeCloseTo(right(boundaryId('/', 'long_output_name')), 0);
  }, 20000);

  it('lays out a chain of right-column ports without throwing', async () => {
    const design = ioDesign([
      'connect_bd_net [get_bd_ports a] [get_bd_ports b] [get_bd_pins u/x]',
      'connect_bd_net [get_bd_ports b] [get_bd_ports c] [get_bd_pins u/z]',
    ]);
    const input = buildElkInput(design, '/', { measure: fakeMeasure });
    const edgeFrom = (from: string, to: string) =>
      (input.edges ?? []).some(
        (edge) =>
          edge.sources[0].startsWith(boundaryId('/', from)) &&
          edge.targets[0].startsWith(boundaryId('/', to))
      );
    expect(edgeFrom('a', 'b')).toBe(true);
    expect(edgeFrom('b', 'c')).toBe(true);
    await expect(runElkLayout(input)).resolves.toBeDefined();
  }, 20000);

  it('puts an exported conduit end in the left column and a conduit start in the right', async () => {
    const design = readQsysTcl(
      [
        'add_instance pio altera_avalon_pio',
        'add_interface in_c conduit end',
        'set_interface_property in_c EXPORT_OF pio.external_connection',
        'add_interface out_c conduit start',
        'set_interface_property out_c EXPORT_OF pio.other_connection',
      ].join('\n'),
      'conduits.tcl'
    );
    const names = design.levels['/'].boundaryPins.map((pin) => pin.name);
    expect(names).toEqual(expect.arrayContaining(['in_c', 'out_c']));
    const { ins, outs } = await expectPortColumns(design, '/', {}, false);
    expect(ins.map((node) => node.id)).toContain(boundaryId('/', 'in_c'));
    expect(outs.map((node) => node.id)).toContain(boundaryId('/', 'out_c'));
  }, 20000);
});
