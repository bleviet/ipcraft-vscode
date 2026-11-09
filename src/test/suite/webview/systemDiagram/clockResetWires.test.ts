import * as fs from 'fs';
import * as path from 'path';
import { readBdTcl } from '../../../../parser/system/BdTclReader';
import type { SystemGraph } from '../../../../domain/systemGraph';
import {
  buildElkInput,
  toFlowElements,
  type DiagramFlowEdge,
  type DiagramFlowNode,
} from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { levelEdges } from '../../../../webview/systemDiagram/layout/levelEdges';
import { badgeDrawnWidth } from '../../../../webview/systemDiagram/layout/netBadges';
import { frameLabelWidths } from '../../../../webview/systemDiagram/layout/expandedLayout';
import { isolationSubset } from '../../../../webview/systemDiagram/isolation';
import { isClockOrReset } from '../../../../webview/systemDiagram/model';
import {
  fakeMeasure,
  loadClockFixtureGraph,
  loadFixtureGraph,
  loadPortClocksGraph,
  loadVersalClockGraph,
} from './fixtureGraph';

async function layoutOf(
  graph: SystemGraph,
  level: string,
  options: { expanded?: string[]; isolate?: ReturnType<typeof isolationSubset> } = {}
) {
  const input = buildElkInput(graph, level, {
    measure: fakeMeasure,
    ...(options.expanded && { expanded: new Set(options.expanded) }),
    ...(options.isolate && { isolate: options.isolate }),
  });
  return toFlowElements(await runElkLayout(input), graph, level, fakeMeasure, options.isolate);
}

const isWire = (graph: SystemGraph, edge: DiagramFlowEdge) =>
  isClockOrReset(graph.nets.find((net) => net.id === edge.data.netId)!);

/** Just past the drawn text of the badge of `pin` on `node`, at the pin height. */
function badgeEnd(node: DiagramFlowNode, pin: string) {
  const badge =
    node.type === 'boundary'
      ? node.data.badge
      : [...node.data.west, ...node.data.east].find((row) => row.name === pin)?.badge;
  expect(badge).toBeDefined();
  const y = node.position.y + badge!.y + badge!.height / 2;
  const drawn = badgeDrawnWidth(badge!, fakeMeasure);
  return {
    x: node.position.x + (badge!.x < 0 ? badge!.x + badge!.width - drawn : badge!.x + drawn),
    y,
  };
}

function crossesInterior(
  a: { x: number; y: number },
  b: { x: number; y: number },
  node: DiagramFlowNode
): boolean {
  const { x, y } = node.position;
  const loX = Math.min(a.x, b.x);
  const hiX = Math.max(a.x, b.x);
  const loY = Math.min(a.y, b.y);
  const hiY = Math.max(a.y, b.y);
  return loX < x + node.width && hiX > x && loY < y + node.height && hiY > y;
}

const designs: [string, () => SystemGraph][] = [
  ['zynq_dma_system', loadFixtureGraph],
  ['versal_clocks', loadVersalClockGraph],
  ['zynq_clock_domains', loadClockFixtureGraph],
  ['subsystem_two_clocks', loadPortClocksGraph],
];

describe('clock and reset wires on the root level', () => {
  for (const [name, load] of designs) {
    it(`draws one wire per edge on ${name}, ending at the sink badges and clear of blocks`, async () => {
      const graph = load();
      const { nodes, edges } = await layoutOf(graph, '/');
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const expected = levelEdges(graph, '/').filter(isClockOrReset);
      const wires = new Map(
        edges.filter((edge) => isWire(graph, edge)).map((edge) => [edge.id, edge])
      );
      expect(expected.length).toBeGreaterThan(0);
      expect([...wires.keys()].sort()).toEqual(expected.map((edge) => edge.id).sort());
      for (const edge of expected) {
        const wire = wires.get(edge.id)!;
        const points = wire.data.points;
        expect(points[points.length - 1]).toEqual(
          badgeEnd(byId.get(edge.targetNode)!, edge.targetPin)
        );
        if (!wire.data.junction) {
          expect(points[0]).toEqual(badgeEnd(byId.get(edge.sourceNode)!, edge.sourcePin));
        }
        for (let i = 1; i < points.length; i++) {
          expect(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y).toBe(true);
          for (const node of nodes) {
            expect({
              wire: edge.id,
              node: node.id,
              through: crossesInterior(points[i - 1], points[i], node),
            }).toEqual({ wire: edge.id, node: node.id, through: false });
          }
        }
      }
    }, 30000);
  }

  it('lists the clock and reset wires before the data wires', async () => {
    const graph = loadFixtureGraph();
    const { edges } = await layoutOf(graph, '/');
    const kinds = edges.map((edge) => isWire(graph, edge));
    expect(kinds.indexOf(false)).toBeGreaterThan(0);
    expect(kinds.slice(kinds.indexOf(false)).includes(true)).toBe(false);
  }, 30000);
});

/** Inner wires of `frameId` stay inside the frame, off its label strips and its blocks, and meet its pins on the border. */
function expectInnerWires(
  graph: SystemGraph,
  nodes: DiagramFlowNode[],
  edges: DiagramFlowEdge[],
  frameId: string
) {
  const frame = nodes.find((node) => node.id === frameId)!;
  if (frame.type !== 'frame') {
    throw new Error('expected a frame');
  }
  const inner = levelEdges(graph, frameId).filter(isClockOrReset);
  expect(inner.length).toBeGreaterThan(0);
  const pad = frameLabelWidths(frame.data.instance, fakeMeasure);
  const strips = [
    [frame.position.x, frame.position.x + pad.west],
    [frame.position.x + frame.width - pad.east, frame.position.x + frame.width],
  ];
  const rows = [...frame.data.west, ...frame.data.east];
  const members = nodes.filter((node) => graph.levels[frameId].instances.includes(node.id));
  for (const edge of inner) {
    const wire = edges.find((candidate) => candidate.id === edge.id);
    expect(wire).toBeDefined();
    const points = wire!.data.points;
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(frame.position.x);
      expect(point.x).toBeLessThanOrEqual(frame.position.x + frame.width);
      expect(point.y).toBeGreaterThanOrEqual(frame.position.y);
      expect(point.y).toBeLessThanOrEqual(frame.position.y + frame.height);
    }
    for (let i = 1; i < points.length; i++) {
      for (const node of members) {
        expect({
          wire: edge.id,
          node: node.id,
          through: crossesInterior(points[i - 1], points[i], node),
        }).toEqual({ wire: edge.id, node: node.id, through: false });
      }
      if (points[i].x === points[i - 1].x) {
        for (const [left, right] of strips) {
          expect({ wire: edge.id, inside: points[i].x > left && points[i].x < right }).toEqual({
            wire: edge.id,
            inside: false,
          });
        }
      }
    }
    const ends = [
      [points[points.length - 1], edge.targetNode, edge.targetPin, true],
      [points[0], edge.sourceNode, edge.sourcePin, !wire!.data.junction],
    ] as const;
    for (const [point, node, pin, isPinEnd] of ends) {
      const row = rows.find((candidate) => candidate.name === pin);
      if (node === frame.id && row && isPinEnd) {
        expect(point).toEqual({
          x: frame.data.west.includes(row) ? frame.position.x : frame.position.x + frame.width,
          y: frame.position.y + row.y,
        });
      }
    }
  }
}

/** Collinear overlaps longer than 0.5 px between wires of different nets of one level. */
function overlaps(graph: SystemGraph, edges: DiagramFlowEdge[]): string[] {
  const found: string[] = [];
  const buckets = new Map<string, { net: string; lo: number; hi: number; id: string }[]>();
  for (const edge of edges) {
    const net = graph.nets.find((candidate) => candidate.id === edge.data.netId)!;
    const { points } = edge.data;
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      const horizontal = a.y === b.y;
      const key = `${net.level}|${horizontal ? 'h' : 'v'}|${horizontal ? a.y : a.x}`;
      const [lo, hi] = horizontal
        ? [Math.min(a.x, b.x), Math.max(a.x, b.x)]
        : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
      const bucket = buckets.get(key) ?? [];
      for (const other of bucket) {
        if (other.net !== net.id && Math.min(hi, other.hi) - Math.max(lo, other.lo) > 0.5) {
          found.push(`${key}: ${edge.id} / ${other.id}`);
        }
      }
      bucket.push({ net: net.id, lo, hi, id: edge.id });
      buckets.set(key, bucket);
    }
  }
  return found;
}

describe('clock and reset wires of an expanded block', () => {
  it('routes the inner level inside the frame, clear of its labels', async () => {
    const graph = loadFixtureGraph();
    const { nodes, edges } = await layoutOf(graph, '/', { expanded: ['/dsp_pipeline'] });
    expectInnerWires(
      graph,
      nodes,
      edges.filter((edge) => isWire(graph, edge)),
      '/dsp_pipeline'
    );
  }, 30000);

  it('starts the lead of a junction wire from the frame at the border', async () => {
    const graph = loadFixtureGraph();
    const { nodes, edges } = await layoutOf(graph, '/', { expanded: ['/dsp_pipeline'] });
    const frame = nodes.find((node) => node.id === '/dsp_pipeline')!;
    const fromFrame = edges.filter(
      (edge) => edge.source === '/dsp_pipeline' && edge.data.junction && isWire(graph, edge)
    );
    expect(fromFrame.length).toBeGreaterThan(0);
    for (const edge of fromFrame) {
      const lead = edge.data.lead!;
      expect([frame.position.x, frame.position.x + frame.width]).toContain(lead[0].x);
      expect(lead[lead.length - 1]).toEqual(edge.data.points[0]);
    }
  }, 30000);

  it('does the same for a block expanded inside an expanded block', async () => {
    const graph = loadFixtureGraph();
    const { nodes, edges } = await layoutOf(graph, '/', {
      expanded: ['/dsp_pipeline', '/dsp_pipeline/coeff_bank'],
    });
    const wires = edges.filter((edge) => isWire(graph, edge));
    expectInnerWires(graph, nodes, wires, '/dsp_pipeline');
    expectInnerWires(graph, nodes, wires, '/dsp_pipeline/coeff_bank');
  }, 30000);
});

describe('wires of different clock and reset nets', () => {
  const load8ch = () =>
    readBdTcl(
      fs.readFileSync(
        path.resolve(__dirname, '../../../fixtures/system-design/generated/vivado_dsp_soc_8ch.tcl'),
        'utf8'
      ),
      'vivado_dsp_soc_8ch.tcl'
    );
  const cases: [string, () => SystemGraph, string[]][] = [
    ['zynq_dma_system', loadFixtureGraph, []],
    [
      'zynq_dma_system with nested blocks expanded',
      loadFixtureGraph,
      ['/dsp_pipeline', '/dsp_pipeline/coeff_bank'],
    ],
    ['versal_clocks', loadVersalClockGraph, []],
    ['zynq_clock_domains', loadClockFixtureGraph, []],
    ['subsystem_two_clocks', loadPortClocksGraph, []],
    ['vivado_dsp_soc_8ch', load8ch, []],
    ['vivado_dsp_soc_8ch with ch0 expanded', load8ch, ['/ch0', '/ch0/dsp']],
  ];
  for (const [name, load, expanded] of cases) {
    it(`never share a line on ${name}`, async () => {
      const graph = load();
      const { edges } = await layoutOf(graph, '/', { expanded });
      const wires = edges.filter((edge) => isWire(graph, edge));
      expect(wires.length).toBeGreaterThan(0);
      expect(overlaps(graph, wires)).toEqual([]);
    }, 60000);
  }
});

describe('the frame wire channel', () => {
  it('keeps the trunks of different nets in the channel beside the label strip a lane step apart', async () => {
    const graph = readBdTcl(
      fs.readFileSync(
        path.resolve(__dirname, '../../../fixtures/system-design/generated/vivado_dsp_soc_8ch.tcl'),
        'utf8'
      ),
      'vivado_dsp_soc_8ch.tcl'
    );
    const { nodes, edges } = await layoutOf(graph, '/', { expanded: ['/ch0'] });
    const frame = nodes.find((node) => node.id === '/ch0')!;
    if (frame.type !== 'frame') {
      throw new Error('expected a frame');
    }
    const strip = frameLabelWidths(frame.data.instance, fakeMeasure).west;
    const trunks = new Map<number, string>();
    for (const edge of edges.filter((candidate) => isWire(graph, candidate))) {
      const net = graph.nets.find((candidate) => candidate.id === edge.data.netId)!;
      if (net.level !== '/ch0') {
        continue;
      }
      const { points } = edge.data;
      for (let i = 1; i < points.length; i++) {
        const near = points[i].x - frame.position.x - strip;
        if (points[i].x === points[i - 1].x && near >= 0 && near < 24) {
          trunks.set(points[i].x, `${trunks.get(points[i].x) ?? ''}|${net.id}`);
        }
      }
    }
    const xs = [...trunks.keys()].sort((a, b) => a - b);
    expect(xs.length).toBeGreaterThan(1);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(6);
    }
  }, 60000);
});

describe('clock and reset wires of an isolated view', () => {
  it('draws only the edges the isolation keeps', async () => {
    const graph = loadFixtureGraph();
    const isolate = isolationSubset(graph, '/', ['/axi_dma_0', '/processing_system7_0'], 2);
    const { edges } = await layoutOf(graph, '/', { isolate });
    const wires = edges.filter((edge) => isWire(graph, edge)).map((edge) => edge.id);
    const kept = levelEdges(graph, '/')
      .filter(isClockOrReset)
      .filter((edge) => isolate.edgeIds.has(edge.id))
      .map((edge) => edge.id);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(levelEdges(graph, '/').filter(isClockOrReset).length);
    expect(wires.sort()).toEqual(kept.sort());
  }, 30000);
});
