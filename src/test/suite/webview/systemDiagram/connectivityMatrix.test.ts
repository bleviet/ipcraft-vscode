import {
  connectivityMatrix,
  matrixKey,
} from '../../../../webview/systemDiagram/connectivityMatrix';
import { boundaryId } from '../../../../webview/systemDiagram/model';
import { archGraph } from './archGraph';
import { designOf, instance, net } from './bundlingGraph';
import { pin } from './foldingGraph';

const cell = (matrix: ReturnType<typeof connectivityMatrix>, from: string, to: string) =>
  matrix.cells.get(matrixKey(from, to));

describe('connectivityMatrix', () => {
  const matrix = connectivityMatrix(archGraph(), '/');

  it('counts connections per category from row to column, most first', () => {
    expect(cell(matrix, '/src', '/dst')).toEqual([
      { category: 'axis', count: 3 },
      { category: 'aximm', count: 1 },
      { category: 'interrupt', count: 1 },
    ]);
  });

  it('keeps direction: the reverse cell is empty', () => {
    expect(cell(matrix, '/dst', '/src')).toBeUndefined();
  });

  it('leaves out clock and reset edges and the nodes with no other edge', () => {
    expect(matrix.nodes.map((node) => node.label)).toEqual(['src', 'dst']);
    expect([...matrix.cells.keys()]).toEqual([matrixKey('/src', '/dst')]);
  });

  it('leaves out the edges of inner levels', () => {
    expect(connectivityMatrix(archGraph(), '/').nodes.map((node) => node.id)).not.toContain(
      '/sub/a'
    );
    expect(connectivityMatrix(archGraph(), '/sub').nodes.map((node) => node.label)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('orders rows and columns like the topological helper, ports included', () => {
    const blocks = [
      instance('b', [pin('i', 'in'), pin('o', 'out')]),
      instance('a', [pin('i', 'in'), pin('o', 'out')]),
    ];
    const graph = designOf(
      blocks,
      [
        net('n_in', 'signal', [
          [null as unknown as string, 'din'],
          ['/b', 'i'],
        ]),
        net('b_a', 'signal', [
          ['/b', 'o'],
          ['/a', 'i'],
        ]),
      ],
      {
        '/': {
          path: '/',
          name: 'design',
          boundaryPins: [pin('din', 'in')],
          instances: ['/b', '/a'],
        },
      }
    );
    const result = connectivityMatrix(graph, '/');
    expect(result.nodes).toEqual([
      { id: boundaryId('/', 'din'), label: 'din', kind: 'boundary' },
      { id: '/b', label: 'b', kind: 'instance' },
      { id: '/a', label: 'a', kind: 'instance' },
    ]);
  });

  it('counts a node wired to itself in its diagonal cell', () => {
    const graph = designOf(
      [instance('x', [pin('o', 'out'), pin('i', 'in')])],
      [
        net('loop', 'signal', [
          ['/x', 'o'],
          ['/x', 'i'],
        ]),
      ]
    );
    expect(cell(connectivityMatrix(graph, '/'), '/x', '/x')).toEqual([
      { category: 'signal', count: 1 },
    ]);
  });
});
