import type { ElkNode } from 'elkjs/lib/elk-api';
import { isolationSubset } from '../../../../webview/systemDiagram/isolation';
import { buildElkInput } from '../../../../webview/systemDiagram/layout/elkLayout';
import {
  NETWORK_SIMPLEX_MAX_SIZE,
  NODE_PLACEMENT,
  elkGraphSize,
  layeredGraphSize,
  longEdgeDummies,
  nodePlacementFor,
  withNodePlacement,
} from '../../../../webview/systemDiagram/layout/nodePlacement';
import { instance, net } from './bundlingGraph';
import { chainGraph } from './chainGraph';
import { fakeMeasure, loadFixtureGraph } from './fixtureGraph';
import { pin } from './foldingGraph';

const DSP = '/dsp_pipeline';

/** A chain of `count` blocks, each driving the next: `count` nodes and `count - 1` edges. */
function longChain(count: number) {
  const blocks = Array.from({ length: count }, (_, index) => `b${index}`);
  return chainGraph(
    blocks,
    blocks.slice(1).map((block, index) => [blocks[index], block, 'axis'])
  );
}

/**
 * `longChain(stages)` with one clock net and one reset net from their own
 * driver blocks to every stage, as a deep pipeline is clocked: few nodes and
 * edges, but the clock and reset edges cross many layers.
 */
function clockedPipeline(stages: number) {
  const graph = longChain(stages);
  const blocks = [...graph.levels['/'].instances];
  for (const [driver, category] of [
    ['clk', 'clock'],
    ['rst', 'reset'],
  ] as const) {
    graph.instances[`/${driver}`] = instance(driver, [pin('out', 'out')]);
    graph.levels['/'].instances.push(`/${driver}`);
    for (const block of blocks) {
      graph.instances[block].pins.push(pin(driver, 'in'));
    }
    graph.nets.push(
      net(driver, category, [
        [`/${driver}`, 'out'],
        ...blocks.map((block): [string, string] => [block, driver]),
      ])
    );
  }
  return graph;
}

describe('nodePlacementFor', () => {
  it('keeps network simplex up to the threshold and uses Brandes-Koepf above it', () => {
    expect(nodePlacementFor(0)).toBe('NETWORK_SIMPLEX');
    expect(nodePlacementFor(NETWORK_SIMPLEX_MAX_SIZE)).toBe('NETWORK_SIMPLEX');
    expect(nodePlacementFor(NETWORK_SIMPLEX_MAX_SIZE + 1)).toBe('BRANDES_KOEPF');
  });
});

describe('elkGraphSize', () => {
  it('counts the nodes and edges at every depth, not the root', () => {
    const graph: ElkNode = {
      id: 'root',
      children: [{ id: 'a' }, { id: 'frame', children: [{ id: 'b' }, { id: 'c' }], edges: [] }],
      edges: [
        { id: 'e1', sources: ['a'], targets: ['b'] },
        { id: 'e2', sources: ['b'], targets: ['c'] },
      ],
    };
    expect(elkGraphSize(graph)).toBe(6);
  });
});

describe('longEdgeDummies', () => {
  const node = (id: string, layoutOptions?: Record<string, string>): ElkNode => ({
    id,
    ports: [{ id: `${id}::p` }],
    ...(layoutOptions && { layoutOptions }),
  });
  const edge = (id: string, from: string, to: string) => ({
    id,
    sources: [`${from}::p`],
    targets: [`${to}::p`],
  });

  it('counts the layers each edge crosses in a longest-path layering, cycles broken', () => {
    const graph: ElkNode = {
      id: 'root',
      children: [node('a'), node('b'), node('c')],
      // a, b and c take layers 0, 1 and 2; a -> c crosses one, and so does the cycle edge c -> a.
      edges: [
        edge('ab', 'a', 'b'),
        edge('bc', 'b', 'c'),
        edge('ac', 'a', 'c'),
        edge('ca', 'c', 'a'),
      ],
    };
    expect(longEdgeDummies(graph)).toBe(2);
    expect(layeredGraphSize(graph)).toBe(3 + 4 + 2);
  });

  it('puts a node constrained to the last layer there, and reads ports inside compound nodes', () => {
    const graph: ElkNode = {
      id: 'root',
      children: [
        { ...node('frame'), children: [node('a'), node('b')] },
        node('end', { 'elk.layered.layering.layerConstraint': 'LAST' }),
      ],
      edges: [edge('ab', 'a', 'b'), edge('b-frame', 'b', 'frame'), edge('a-end', 'a', 'end')],
    };
    // a, b and the frame take layers 0, 1 and 2; `end` moves from 1 to 2.
    expect(longEdgeDummies(graph)).toBe(1);
  });
});

describe('withNodePlacement', () => {
  const options = { 'elk.algorithm': 'layered', [NODE_PLACEMENT]: 'NETWORK_SIMPLEX' };
  const block = (id: string): ElkNode => ({
    id,
    layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
  });

  it('sets the placement on the root and every compound node, without touching its input', () => {
    const blocks = Array.from({ length: NETWORK_SIMPLEX_MAX_SIZE }, (_, index) =>
      block(`n${index}`)
    );
    const input: ElkNode = {
      id: 'root',
      layoutOptions: options,
      children: [{ id: 'frame', layoutOptions: options, children: blocks }],
    };
    const placed = withNodePlacement(input);
    expect(placed.layoutOptions?.[NODE_PLACEMENT]).toBe('BRANDES_KOEPF');
    expect(placed.children?.[0].layoutOptions?.[NODE_PLACEMENT]).toBe('BRANDES_KOEPF');
    expect(placed.children?.[0].children?.[0]).toBe(blocks[0]);
    expect(options[NODE_PLACEMENT]).toBe('NETWORK_SIMPLEX');
  });

  it('leaves a small graph as it is', () => {
    const input: ElkNode = { id: 'root', layoutOptions: options, children: [block('a')] };
    expect(withNodePlacement(input)).toEqual(input);
  });
});

describe('buildElkInput placement strategy', () => {
  const graph = loadFixtureGraph();

  it('places a fixture level by network simplex, an expanded frame too', () => {
    expect(
      buildElkInput(graph, '/', { measure: fakeMeasure }).layoutOptions?.[NODE_PLACEMENT]
    ).toBe('NETWORK_SIMPLEX');
    const expanded = buildElkInput(graph, '/', { measure: fakeMeasure, expanded: new Set([DSP]) });
    expect(expanded.layoutOptions?.[NODE_PLACEMENT]).toBe('NETWORK_SIMPLEX');
    const frame = expanded.children?.find((child) => child.id === DSP);
    expect(frame?.layoutOptions?.[NODE_PLACEMENT]).toBe('NETWORK_SIMPLEX');
  });

  it('places a large level by Brandes-Koepf, counting what is emitted', () => {
    const size = Math.ceil(NETWORK_SIMPLEX_MAX_SIZE / 2) + 1;
    const chain = longChain(size);
    const input = buildElkInput(chain, '/', { measure: fakeMeasure });
    expect(elkGraphSize(input)).toBe(2 * size - 1);
    expect(input.layoutOptions?.[NODE_PLACEMENT]).toBe('BRANDES_KOEPF');
    // Isolating one block of it emits a small graph again.
    const isolated = buildElkInput(chain, '/', {
      measure: fakeMeasure,
      isolate: isolationSubset(chain, '/', ['/b0']),
    });
    expect(elkGraphSize(isolated)).toBe(3);
    expect(isolated.layoutOptions?.[NODE_PLACEMENT]).toBe('NETWORK_SIMPLEX');
  });

  it('places a deep pipeline clocked from one net by Brandes-Koepf, though it has few nodes and edges', () => {
    const input = buildElkInput(clockedPipeline(20), '/', { measure: fakeMeasure });
    expect(elkGraphSize(input)).toBeLessThan(NETWORK_SIMPLEX_MAX_SIZE / 4);
    expect(layeredGraphSize(input)).toBeGreaterThan(NETWORK_SIMPLEX_MAX_SIZE);
    expect(input.layoutOptions?.[NODE_PLACEMENT]).toBe('BRANDES_KOEPF');
    // The same pipeline without its clock and reset stays with network simplex.
    expect(
      buildElkInput(longChain(20), '/', { measure: fakeMeasure }).layoutOptions?.[NODE_PLACEMENT]
    ).toBe('NETWORK_SIMPLEX');
  });
});
