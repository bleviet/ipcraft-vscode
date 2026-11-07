import { outlineVisibility } from '../../../../webview/systemDiagram/outlineFilter';
import { archGraph } from './archGraph';

const graph = archGraph();

describe('outlineVisibility', () => {
  it('restricts nothing for All', () => {
    expect(outlineVisibility(graph, 'all')).toEqual({ instances: null, ports: true });
  });

  it('keeps the hierarchy instances for Subsystems and no ports', () => {
    const { instances, ports } = outlineVisibility(graph, 'subsystems');
    expect([...instances!]).toEqual(['/sub']);
    expect(ports).toBe(false);
  });

  it('keeps the other instances for IP / RTL with the hierarchy rows above them', () => {
    const { instances, ports } = outlineVisibility(graph, 'ip');
    expect([...instances!].sort()).toEqual(
      ['/dst', '/src', '/sub', '/sub/a', '/sub/b', '/sub/c', '/sub/lone'].sort()
    );
    expect(ports).toBe(false);
  });

  it('keeps only the ports for Ports', () => {
    expect(outlineVisibility(graph, 'ports')).toEqual({ instances: new Set(), ports: true });
  });

  it('keeps every ancestor of a match in a nested hierarchy', () => {
    const nested = {
      ...graph,
      instances: {
        ...graph.instances,
        '/sub/deep': {
          ...graph.instances['/sub/a'],
          path: '/sub/deep',
          name: 'deep',
          kind: 'hier' as const,
        },
        '/sub/deep/leaf': {
          ...graph.instances['/sub/a'],
          path: '/sub/deep/leaf',
          name: 'leaf',
          parent: '/sub/deep',
        },
      },
    };
    const { instances } = outlineVisibility(nested, 'ip');
    expect(instances!.has('/sub/deep')).toBe(true);
    expect(instances!.has('/sub/deep/leaf')).toBe(true);
    expect([...outlineVisibility(nested, 'subsystems').instances!].sort()).toEqual([
      '/sub',
      '/sub/deep',
    ]);
  });
});
