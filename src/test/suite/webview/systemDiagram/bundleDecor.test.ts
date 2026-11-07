import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { bundleMarks } from '../../../../webview/systemDiagram/clocks/edgeView';
import { clockDecor } from '../../../../webview/systemDiagram/clockDecor';
import { bundleOfSelection, edgeNetIds } from '../../../../webview/systemDiagram/edgeNets';
import type { DiagramFlowEdge } from '../../../../webview/systemDiagram/layout/elkLayout';
import { highlightedPinsByNode } from '../../../../webview/systemDiagram/pinHighlight';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { fakeMeasure, loadClockFixtureGraph } from './fixtureGraph';

const bundleEdge = (
  key: string,
  members: { netId: string; edgeId?: string; sh?: string; th?: string }[],
  category: DiagramFlowEdge['data']['category'] = 'axis'
) =>
  ({
    id: key,
    type: 'elk',
    source: '/a',
    target: '/b',
    sourceHandle: members[0].sh ?? 'm1',
    targetHandle: members[0].th ?? 's1',
    data: {
      netId: members[0].netId,
      points: [],
      category,
      isInterface: true,
      bundle: {
        key,
        label: `×${members.length} AXIS`,
        branches: [],
        members: members.map((member, index) => ({
          edgeId: member.edgeId ?? `${member.netId}#1`,
          netId: member.netId,
          sourcePin: `m${index}`,
          targetPin: `s${index}`,
          sourceHandle: member.sh ?? `m${index}`,
          targetHandle: member.th ?? `s${index}`,
        })),
      },
    },
  }) as DiagramFlowEdge;

describe('edgeNetIds', () => {
  it('is the net of a plain wire and every member net of a bundle', () => {
    expect(edgeNetIds({ data: { netId: 'n1' } })).toEqual(['n1']);
    expect(edgeNetIds(bundleEdge('b', [{ netId: 'n1' }, { netId: 'n2' }]))).toEqual(['n1', 'n2']);
  });
});

describe('bundleOfSelection', () => {
  const edges = [
    bundleEdge('b', [{ netId: 'n1' }, { netId: 'n2' }, { netId: 'n3' }]),
    bundleEdge('twin', [{ netId: 'n1' }, { netId: 'n2' }, { netId: 'n3' }]),
    bundleEdge('fan', [{ netId: 'f' }, { netId: 'f' }]),
  ];
  const nets = (...ids: string[]) => ids.map((id) => ({ kind: 'net' as const, id }));

  it('matches a selection of exactly the member nets of the active bundle, in any order', () => {
    expect(bundleOfSelection(edges, nets('n3', 'n1', 'n2'), 'b')).toBe(edges[0]);
  });

  it('shows the bundle that was clicked among bundles with the same nets', () => {
    expect(bundleOfSelection(edges, nets('n1', 'n2', 'n3'), 'twin')).toBe(edges[1]);
  });

  it('matches a fan-out bundle with one net, which is selected once', () => {
    expect(edgeNetIds(edges[2])).toEqual(['f']);
    expect(bundleOfSelection(edges, nets('f'), 'fan')).toBe(edges[2]);
  });

  it('does not match a subset, a superset, a non-net, a stale or no key', () => {
    expect(bundleOfSelection(edges, nets('n1', 'n2'), 'b')).toBeUndefined();
    expect(bundleOfSelection(edges, nets('n1', 'n2', 'n3', 'n4'), 'b')).toBeUndefined();
    expect(
      bundleOfSelection(edges, [...nets('n1', 'n2'), { kind: 'instance', id: '/a' }], 'b')
    ).toBeUndefined();
    expect(bundleOfSelection(edges, [], 'b')).toBeUndefined();
    expect(bundleOfSelection(edges, nets('f'), 'b')).toBeUndefined();
    expect(bundleOfSelection(edges, nets('n1', 'n2', 'n3'), null)).toBeUndefined();
    expect(bundleOfSelection(edges, nets('n1', 'n2', 'n3'), 'gone')).toBeUndefined();
  });
});

describe('bundleMarks', () => {
  it('is a crossing when any member is one', () => {
    expect(bundleMarks([{ dimmed: true }, { crossing: true }, { dimmed: true }])).toEqual({
      crossing: true,
    });
  });

  it('keeps a domain color only when every member shares it', () => {
    expect(bundleMarks([{ domainColor: 'red' }, { domainColor: 'red' }])).toEqual({
      domainColor: 'red',
    });
    expect(bundleMarks([{ domainColor: 'red' }, { domainColor: 'blue' }])).toEqual({});
    expect(bundleMarks([{ domainColor: 'red' }, {}])).toEqual({});
  });

  it('keeps dimmed and dotted only when every member has them', () => {
    expect(bundleMarks([{ dimmed: true }, { dimmed: true }])).toEqual({ dimmed: true });
    expect(bundleMarks([{ dimmed: true }, {}])).toEqual({});
    expect(
      bundleMarks([
        { dotted: true, domainColor: 'red' },
        { dotted: true, domainColor: 'red' },
      ])
    ).toEqual({ dotted: true, domainColor: 'red' });
    expect(bundleMarks([{ dotted: true }, {}])).toEqual({});
  });
});

describe('highlightedPinsByNode on a bundle', () => {
  it('bolds the pins of each selected member, not the representative', () => {
    const edges = [bundleEdge('b', [{ netId: 'n1' }, { netId: 'n2' }, { netId: 'n3' }])];
    const pins = highlightedPinsByNode(new Set(['n1', 'n3']), edges, []);
    expect([...pins.entries()].map(([id, set]) => [id, [...set].sort()])).toEqual([
      ['/a', ['m0', 'm2']],
      ['/b', ['s0', 's2']],
    ]);
  });
});

describe('clockDecor on a bundle', () => {
  const graph = loadClockFixtureGraph();
  const analysis = analyzeClocks(graph);
  const context = { graph, analysis, levelPath: '/', domainMode: true };

  it('is a crossing when one member net crosses clock domains, however many do not', async () => {
    const laidOut = await runElkLayout(buildElkInput(graph, '/', { measure: fakeMeasure }));
    const { edges } = toFlowElements(laidOut, graph, '/', fakeMeasure);
    const idOf = (netId: string) => edges.find((edge) => edge.data.netId === netId)!.id;
    const crossing = '/::dsp_pipeline_M_AXIS';
    const plain = '/::ps7_0_axi_periph_M00_AXI';
    const mixed = bundleEdge('mixed', [
      { netId: plain, edgeId: idOf(plain) },
      { netId: crossing, edgeId: idOf(crossing) },
    ]);
    const calm = bundleEdge('calm', [{ netId: plain, edgeId: idOf(plain) }, { netId: plain }]);
    const decor = clockDecor({ nodes: [], edges: [mixed, calm] }, context, null);
    expect(decor.edges.get('mixed')).toEqual({ crossing: true });
    expect(decor.edges.get('calm')).toEqual({ dimmed: true });
  }, 20000);
});
