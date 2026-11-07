import { topologicalInstanceOrder } from '../../../../webview/systemDiagram/layout/levelOrder';
import { archGraph } from './archGraph';
import { designOf, instance, net } from './bundlingGraph';
import { pin } from './foldingGraph';

const blocks = (...names: string[]) =>
  names.map((name) => instance(name, [pin('i', 'in'), pin('o', 'out')]));
const wire = (from: string, to: string, category: 'signal' | 'clock' | 'reset' = 'signal') =>
  net(`${from}_${to}`, category, [
    [`/${from}`, 'o'],
    [`/${to}`, 'i'],
  ]);

describe('topologicalInstanceOrder', () => {
  it('puts a driver before its sinks and ties by name', () => {
    const graph = designOf(blocks('c', 'a', 'b', 'd'), [
      wire('a', 'c'),
      wire('b', 'c'),
      wire('c', 'd'),
    ]);
    expect(topologicalInstanceOrder(graph, '/')).toEqual(['/a', '/b', '/c', '/d']);
  });

  it('orders the unconnected instances by name among the ready ones', () => {
    const graph = designOf(blocks('z', 'y', 'x'), [wire('z', 'x')]);
    expect(topologicalInstanceOrder(graph, '/')).toEqual(['/y', '/z', '/x']);
  });

  it('ignores clock and reset nets', () => {
    const graph = designOf(blocks('b', 'a'), [wire('b', 'a', 'clock'), wire('b', 'a', 'reset')]);
    expect(topologicalInstanceOrder(graph, '/')).toEqual(['/a', '/b']);
  });

  it('breaks a cycle at the first instance by name and goes on', () => {
    const graph = designOf(blocks('c', 'b', 'a', 'd'), [
      wire('a', 'b'),
      wire('b', 'c'),
      wire('c', 'a'),
      wire('c', 'd'),
    ]);
    expect(topologicalInstanceOrder(graph, '/')).toEqual(['/a', '/b', '/c', '/d']);
  });

  it('orders the instances of an inner level', () => {
    expect(topologicalInstanceOrder(archGraph(), '/sub')).toEqual([
      '/sub/a',
      '/sub/b',
      '/sub/c',
      '/sub/lone',
    ]);
  });

  it('is empty for a level without instances', () => {
    expect(topologicalInstanceOrder(archGraph(), '/nowhere')).toEqual([]);
  });
});
