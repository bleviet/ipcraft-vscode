import {
  buildElkInput,
  toFlowElements,
  type InstanceNodeData,
} from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { fakeMeasure } from './fixtureGraph';
import { bundlingGraph, designOf, instance, net } from './bundlingGraph';
import { pin } from './foldingGraph';

const BUNDLE = 'bundle:/src->/dst|axis|i';
const none = { unbundled: new Set<string>() };
const closed = { open: new Set<string>() };
const graph = bundlingGraph();

const edgeIds = (input: { edges?: { id: string }[] }) => (input.edges ?? []).map((e) => e.id);

describe('buildElkInput with bus bundling', () => {
  it('is today input without busBundling', () => {
    const plain = buildElkInput(graph, '/', { measure: fakeMeasure });
    expect(edgeIds(plain)).toEqual(['/::n_a#1', '/::n_b#1', '/::n_c#1']);
    expect(buildElkInput(graph, '/', { measure: fakeMeasure, busBundling: undefined })).toEqual(
      plain
    );
  });

  it('emits one edge per bundle between the median ports', () => {
    const input = buildElkInput(graph, '/', { measure: fakeMeasure, busBundling: none });
    expect(input.edges).toEqual([{ id: BUNDLE, sources: ['/src::m_b'], targets: ['/dst::s_b'] }]);
  });

  it('keeps every edge of an unbundled key', () => {
    const input = buildElkInput(graph, '/', {
      measure: fakeMeasure,
      busBundling: { unbundled: new Set([BUNDLE]) },
    });
    expect(edgeIds(input).sort()).toEqual(['/::n_a#1', '/::n_b#1', '/::n_c#1']);
  });

  it('does not bundle across a row that is not a member', () => {
    const gapped = bundlingGraph({ gapAfter: 1 });
    const input = buildElkInput(gapped, '/', { measure: fakeMeasure, busBundling: none });
    expect(edgeIds(input)).toContain('/::n_a#1');
    expect(edgeIds(input)).not.toContain(BUNDLE);
  });

  it('bundles only the edges kept by the isolation subset', () => {
    const isolate = {
      nodeIds: new Set(['/src', '/dst']),
      edgeIds: new Set(['/::n_a#1', '/::n_b#1']),
    };
    const input = buildElkInput(graph, '/', { measure: fakeMeasure, isolate, busBundling: none });
    expect(input.edges).toEqual([{ id: BUNDLE, sources: ['/src::m_a'], targets: ['/dst::s_a'] }]);
  });

  it('bundles the connections of folded pin arrays into one edge between the group ports', () => {
    const numbered = bundlingGraph({ count: 5, numbered: true });
    const input = buildElkInput(numbered, '/', {
      measure: fakeMeasure,
      pinFolding: closed,
      busBundling: none,
    });
    expect(input.edges).toEqual([
      {
        id: BUNDLE,
        sources: ['/src::m_*|master|i'],
        targets: ['/dst::s_*|slave|i'],
      },
    ]);
  });
});

describe('toFlowElements with bus bundling', () => {
  const flowOf = async (options: {
    graph?: ReturnType<typeof bundlingGraph>;
    pinFolding?: typeof closed;
    unbundled?: Set<string>;
    isolate?: { nodeIds: Set<string>; edgeIds: Set<string> };
  }) => {
    const design = options.graph ?? graph;
    const busBundling = { unbundled: options.unbundled ?? new Set<string>() };
    const input = buildElkInput(design, '/', {
      measure: fakeMeasure,
      busBundling,
      ...(options.pinFolding && { pinFolding: options.pinFolding }),
      ...(options.isolate && { isolate: options.isolate }),
    });
    const laidOut = await runElkLayout(input);
    return toFlowElements(
      laidOut,
      design,
      '/',
      fakeMeasure,
      options.pinFolding,
      busBundling,
      options.isolate
    );
  };

  it('draws one flow edge per bundle with its members, label and comb branches', async () => {
    const { edges, nodes } = await flowOf({});
    expect(edges.map((edge) => edge.id)).toEqual([BUNDLE]);
    const edge = edges.find((candidate) => candidate.id === BUNDLE)!;
    expect(edge).toMatchObject({
      type: 'elk',
      source: '/src',
      target: '/dst',
      sourceHandle: 'm_b',
      targetHandle: 's_b',
    });
    expect(edge.data).toMatchObject({ netId: '/::n_a', category: 'axis', isInterface: true });
    const bundle = edge.data.bundle!;
    expect(bundle.key).toBe(BUNDLE);
    expect(bundle.label).toBe('×3 AXIS');
    expect(bundle.members.map((member) => [member.netId, member.sourceHandle])).toEqual([
      ['/::n_a', 'm_a'],
      ['/::n_b', 'm_b'],
      ['/::n_c', 'm_c'],
    ]);
    // Two non-representative pins per end, each run out to the comb and along it to the trunk.
    expect(bundle.branches).toHaveLength(4);
    const points = edge.data.points;
    const src = nodes.find((node) => node.id === '/src')!;
    const [first, last] = [points[0], points[points.length - 1]];
    for (const branch of bundle.branches.slice(0, 2)) {
      expect(branch[2].y).toBeCloseTo(first.y, 5);
      expect(branch[1].x).toBeCloseTo(src.position.x + src.width + 10, 5);
      expect(branch[0].y).toBe(branch[1].y);
    }
    for (const branch of bundle.branches.slice(2)) {
      expect(branch[2].y).toBeCloseTo(last.y, 5);
    }
  }, 20000);

  it('draws the three edges again once the key is unbundled', async () => {
    const { edges } = await flowOf({ unbundled: new Set([BUNDLE]) });
    expect(edges.map((edge) => edge.id).sort()).toEqual(['/::n_a#1', '/::n_b#1', '/::n_c#1']);
    expect(edges.every((edge) => edge.data.bundle === undefined)).toBe(true);
  }, 20000);

  it('respects the isolation subset', async () => {
    const isolate = {
      nodeIds: new Set(['/src', '/dst']),
      edgeIds: new Set(['/::n_a#1', '/::n_b#1']),
    };
    const { edges } = await flowOf({ isolate });
    expect(edges).toHaveLength(1);
    expect(edges[0].data.bundle!.members.map((member) => member.netId)).toEqual([
      '/::n_a',
      '/::n_b',
    ]);
    expect(edges[0].data.bundle!.label).toBe('×2 AXIS');
  }, 20000);

  it('bundles folded pin arrays into one edge on the group handles, without branches', async () => {
    const numbered = bundlingGraph({ count: 5, numbered: true });
    const { edges, nodes } = await flowOf({ graph: numbered, pinFolding: closed });
    const edge = edges.find((candidate) => candidate.id === BUNDLE)!;
    const src = nodes.find((node) => node.id === '/src')!.data as InstanceNodeData;
    expect(edge.sourceHandle).toBe(src.east[0].name);
    expect(edge.data.bundle!.members).toHaveLength(5);
    expect(edge.data.bundle!.branches).toEqual([]);
    expect(edge.data.bundle!.members[2]).toMatchObject({
      sourcePin: 'm_02',
      targetPin: 's_02',
      sourceHandle: edge.sourceHandle,
    });
  }, 20000);
});

describe('bus bundling keeps to one side of a block', () => {
  const edgesOf = async (design: ReturnType<typeof designOf>) => {
    const busBundling = { unbundled: new Set<string>() };
    const input = buildElkInput(design, '/', { measure: fakeMeasure, busBundling });
    const flow = toFlowElements(
      await runElkLayout(input),
      design,
      '/',
      fakeMeasure,
      undefined,
      busBundling
    );
    return { input, flow };
  };

  it('does not bundle a west and an east source pin on adjacent rows', async () => {
    // m0 is an output (east, row 0); m1 has an unknown direction (west, row 1).
    const a = instance('a', [pin('m0', 'out'), pin('x', 'in'), pin('m1', 'unknown')]);
    const b = instance('b', [pin('s0', 'in'), pin('s1', 'in')]);
    const design = designOf(
      [a, b],
      [
        net('n0', 'signal', [
          ['/a', 'm0'],
          ['/b', 's0'],
        ]),
        net('n1', 'signal', [
          ['/a', 'm1'],
          ['/b', 's1'],
        ]),
      ]
    );
    const { input, flow } = await edgesOf(design);
    expect(edgeIds(input)).toEqual(['/::n0#1', '/::n1#1']);
    expect(flow.edges.every((edge) => edge.data.bundle === undefined)).toBe(true);
  }, 20000);

  it('does not bundle a west and an east target pin on adjacent rows', async () => {
    // s0 is an input (west, row 0); s1 an output (east, row 1, after e0 on row 0).
    const a = instance('a', [pin('m0', 'out'), pin('m1', 'out')]);
    const b = instance('b', [pin('s0', 'in'), pin('e0', 'out'), pin('s1', 'out')]);
    const design = designOf(
      [a, b],
      [
        net('n0', 'signal', [
          ['/a', 'm0'],
          ['/b', 's0'],
        ]),
        net('n1', 'signal', [
          ['/a', 'm1'],
          ['/b', 's1'],
        ]),
      ]
    );
    const { input, flow } = await edgesOf(design);
    expect(edgeIds(input)).toEqual(['/::n0#1', '/::n1#1']);
    expect(flow.edges.every((edge) => edge.data.bundle === undefined)).toBe(true);
  }, 20000);
});

describe('bus bundling with an expanded block', () => {
  const x = instance('x', [pin('o0', 'out'), pin('o1', 'out'), pin('p0', 'out'), pin('p1', 'out')]);
  const y = instance('y', [pin('i0', 'in'), pin('i1', 'in')]);
  const h = instance('h', [pin('q0', 'in'), pin('q1', 'in')], 'hier');
  const u = instance('u', [pin('o0', 'out'), pin('o1', 'out')], 'ip', '/h');
  const v = instance('v', [pin('i0', 'in'), pin('i1', 'in')], 'ip', '/h');
  const design = designOf(
    [x, y, h, u, v],
    [
      net('xy0', 'signal', [
        ['/x', 'o0'],
        ['/y', 'i0'],
      ]),
      net('xy1', 'signal', [
        ['/x', 'o1'],
        ['/y', 'i1'],
      ]),
      net('xh0', 'signal', [
        ['/x', 'p0'],
        ['/h', 'q0'],
      ]),
      net('xh1', 'signal', [
        ['/x', 'p1'],
        ['/h', 'q1'],
      ]),
      net(
        'uv0',
        'signal',
        [
          ['/h/u', 'o0'],
          ['/h/v', 'i0'],
        ],
        false,
        '/h'
      ),
      net(
        'uv1',
        'signal',
        [
          ['/h/u', 'o1'],
          ['/h/v', 'i1'],
        ],
        false,
        '/h'
      ),
    ],
    {
      '/': { path: '/', name: 'design', boundaryPins: [], instances: ['/x', '/y', '/h'] },
      '/h': {
        path: '/h',
        name: 'h',
        boundaryPins: [pin('q0', 'in'), pin('q1', 'in')],
        instances: ['/h/u', '/h/v'],
      },
    }
  );
  const options = {
    measure: fakeMeasure,
    expanded: new Set(['/h']),
    busBundling: { unbundled: new Set<string>() },
  };

  it('bundles only the current-level pair away from the frame', () => {
    const ids = edgeIds(buildElkInput(design, '/', options)).sort();
    expect(ids).toEqual(
      ['bundle:/x->/y|signal|s', '/::xh0#1', '/::xh1#1', '/h::uv0#1', '/h::uv1#1'].sort()
    );
  });

  it('draws the same: one bundle flow edge, every other wire on its own', async () => {
    const input = buildElkInput(design, '/', options);
    const flow = toFlowElements(
      await runElkLayout(input),
      design,
      '/',
      fakeMeasure,
      undefined,
      options.busBundling
    );
    expect(flow.edges.filter((edge) => edge.data.bundle).map((edge) => edge.id)).toEqual([
      'bundle:/x->/y|signal|s',
    ]);
    expect(flow.edges).toHaveLength(5);
  }, 20000);
});
